// D3 and D4 as injector rules (base seed-v1, vendor v1 + the INJ rule), with a stub agent applying
// the oracle patches (packages/cli/test/oracles/D3.patch, D4.patch): F PASS, then P, contract
// suite, stored traces, typecheck/lint and ci-local green in the container with no
// UNMATCHED_REQUEST. rerecord-head runs before P and before ci-local, and its RerecordLog lines
// equal a direct `pnpm fiks rerecord-head` call with the same profile on the same head.
// would_open_pr comes only after ci-local is green; every gate invocation has a CandidateRecord.
// Opt-in: FIKS_ORCH_E2E=1.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CandidateRecord, RerecordLog } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import { runArm } from '../../src/commands/repair.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { ARM_TIMEOUT, E2E, fiks, ORACLES, readJsonl, toolsImage } from './support/arm.ts';
import { traceThroughRule } from './support/gen.ts';
import { script, sessionFromPatch } from './support/stubs.ts';

const out = mkdtempSync(join(tmpdir(), 'fiks-orch-inj-'));
const scratch = mkdtempSync(join(tmpdir(), 'fiks-orch-inj-scratch-'));
const strip = ({ at: _at, ...rest }: RerecordLog & { at?: string }) => rest;
const GATES = ['F', 'P', 'suite', 'traces', 'typecheck', 'lint', 'ci-local'];

/**
 * D3 is blocked on CORE (see paper/build-logs/ORCH.md): the D3 fix adds an Idempotency-Key, so the
 * repo's own v1 fixture test/fixtures/v1/order-create.json goes stale too, and CORE's rerecord()
 * re-records every stale recording under the given injector profile (vendor v1 + D3 rule, which
 * sets vendor-api-version 2026-10-01); sameCallAndUpstream then refuses the fixture's re-recording
 * ("re-recorded against a different call or upstream"). FIKS_ORCH_D3=1 runs it anyway.
 */
const BLOCKED: Record<string, boolean> = { D3: process.env.FIKS_ORCH_D3 !== '1', D4: false };

describe.runIf(E2E)('D3 and D4 as injector rules: FIKS arm with a stub agent', () => {
  for (const drift of ['D3', 'D4'] as const) {
    test.skipIf(BLOCKED[drift])(
      `${drift}: every gate green in the container, re-record parity, would_open_pr after ci-local`,
      async () => {
        const pkg = join(ROOT, `packages/injector/fixtures/driftpkgs/${drift}.json`);
        const tracePath = join(scratch, `${drift}.trace.json`);
        writeFileSync(tracePath, await traceThroughRule({ domain: 'shop', rule: pkg, ref: 'seed-v1' }));
        const stub = join(scratch, `${drift}.stub.json`);
        writeFileSync(
          stub,
          JSON.stringify(
            script(sessionFromPatch(repoDir('shop'), 'seed-v1', join(ORACLES, `${drift}.patch`))),
          ),
        );

        const r = await runArm({
          arm: 'fiks',
          runKey: `orch-test/fiks/stub/shop/${drift}/1`,
          traceFile: tracePath,
          base: 'seed-v1',
          rule: pkg,
          agentStub: stub,
          toolsImage: await toolsImage(),
          testTools: true,
          outRoot: out,
          keepWorktree: true,
        });
        expect(r.status, r.reason).toBe('would_open_pr');
        expect(r.profile).toMatchObject({ domain: 'shop', base: 'v1', ruleId: drift });
        expect(r.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(GATES.map((g) => `${g}:true`));
        for (const g of r.gates) expect(g.reason).not.toMatch(/UNMATCHED_REQUEST/);
        expect(r.rerecorded.length).toBeGreaterThan(0);

        // Order: rerecord-head before P and before ci-local; would_open_pr only after ci-local green.
        const ev = readJsonl<{ type: string; ok?: boolean; data: { check?: string } }>(
          join(r.dir, 'events.jsonl'),
        );
        const at = (pred: (e: (typeof ev)[number]) => boolean) => ev.findIndex(pred);
        const rrP = at((e) => e.type === 'rerecord_head' && e.data.check === 'P');
        const rrCi = at((e) => e.type === 'rerecord_head' && e.data.check === 'ci');
        const gP = at((e) => e.type === 'gate_P');
        const gCi = at((e) => e.type === 'gate_ci-local' && e.ok === true);
        const woPr = at((e) => e.type === 'would_open_pr');
        expect(rrP).toBeGreaterThan(-1);
        expect(rrP).toBeLessThan(gP);
        expect(rrCi).toBeGreaterThan(gP);
        expect(rrCi).toBeLessThan(gCi);
        expect(woPr).toBeGreaterThan(gCi);
        expect(ev.filter((e) => e.type === 'would_open_pr')).toHaveLength(1);

        // A CandidateRecord for every gate invocation.
        const index = readJsonl<{ id: string; gate: string; stage: string }>(join(r.dir, 'candidates.jsonl'));
        expect(index.map((c) => c.gate)).toEqual(GATES);
        for (const c of index) {
          const rec = JSON.parse(
            readFileSync(join(r.dir, 'candidates', `${c.id}.json`), 'utf8'),
          ) as CandidateRecord;
          expect(rec.id).toBe(c.id);
          expect(existsSync(rec.diffPath)).toBe(true);
          expect(rec.stage).toBe(c.gate === 'ci-local' ? 'ci' : 'gate');
        }
        const attempt = JSON.parse(readFileSync(join(r.dir, 'attempt.json'), 'utf8'));
        expect(attempt.candidateIds).toEqual(index.map((c) => c.id));
        expect(attempt.rerecordLog).toBe(join(r.dir, 'rerecord.jsonl'));
        expect(attempt.ciFinal).toBe('green');
        expect(attempt.prExposed).toBe(true);

        // Re-record parity: the same profile on the same head, called directly.
        const arm = readJsonl<RerecordLog & { at: string }>(join(r.dir, 'rerecord.jsonl'));
        expect(arm.map((l) => l.check)).toEqual(['P', 'suite', 'traces', 'ci']);
        const wt = r.worktree as string;
        expect(wt).toBeTruthy();
        const repro = r.reproCommit as string;
        const fix = execFileSync('git', ['rev-parse', `${r.headSha}~1`], {
          cwd: wt,
          encoding: 'utf8',
        }).trim();
        execFileSync('git', ['reset', '-q', '--hard', repro], { cwd: wt });
        execFileSync('git', ['checkout', fix, '--', 'src'], { cwd: wt });
        execFileSync('git', ['reset', '-q'], { cwd: wt });
        const log = join(scratch, `${drift}.direct.jsonl`);
        for (const check of ['P', 'suite', 'traces', 'ci']) {
          const d = fiks([
            'rerecord-head',
            '--worktree',
            wt,
            '--profile',
            JSON.stringify(r.profile),
            '--rule',
            join(ROOT, `packages/injector/fixtures/rules/${drift}.json`),
            '--from',
            repro,
            '--log',
            log,
            '--check',
            check,
          ]);
          expect(d.status, d.stderr).toBe(0);
        }
        const direct = readJsonl<RerecordLog & { at: string }>(log);
        expect(direct.map(strip)).toEqual(arm.map(strip));
        expect(arm[0]?.files.some((f) => f.mode === 'stale' && f.outcome === 'rerecorded')).toBe(true);
        execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoDir('shop') });
      },
      ARM_TIMEOUT,
    );
  }
});
