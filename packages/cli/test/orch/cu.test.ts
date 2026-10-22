// FIKS+CU (E4, P12) with stub agents, and the --trace-format pass-through, in process (spies on
// CU's acceptDelta and SAFE's stub runner). Opt-in: FIKS_ORCH_E2E=1.
//  - BEN-DEV-1 (a benign rule adding a $2,500 laptop, base base-shop): a stub ending with a
//    contract_update that widens items.price.range -> acceptDelta called once with non-empty
//    stored traces, clean corpus and mutation variants; accepted; a proposal file; outcome
//    contract_update_proposed; no would_open_pr.
//  - D1 (injector rule, base seed-v1): a delta that silences the D1 trace is rejected; the reasons
//    are in the next session's prompt; the stub's oracle patch then ends as code repair with
//    would_open_pr after green ci-local.
//  - `pnpm fiks repair --trace-format strict` reaches SAFE's runner options.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateContext } from '@fiks/contract-update';
import type { ContractFile } from '@fiks/contracts';
import type { RunnerJob, StubScript } from '@fiks/repair';
import { describe, expect, test, vi } from 'vitest';
import command, { runArm } from '../../src/commands/repair.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { ARM_TIMEOUT, E2E, ORACLES, readJsonl, toolsImage } from './support/arm.ts';
import { contractsAt, ORCH_FIXTURES, traceThroughRule } from './support/gen.ts';
import { script, sessionFromPatch } from './support/stubs.ts';

const spies = vi.hoisted(() => ({
  acceptDelta: [] as { ctx: GateContext; accepted: boolean }[],
  jobs: [] as Pick<RunnerJob, 'traceFormat' | 'prompt' | 'allowedEditPaths' | 'backend'>[],
}));
vi.mock('@fiks/contract-update', async (orig) => {
  const m = await orig<typeof import('@fiks/contract-update')>();
  return {
    ...m,
    acceptDelta: vi.fn((delta: unknown, ctx: GateContext) => {
      const r = m.acceptDelta(delta, ctx);
      spies.acceptDelta.push({ ctx, accepted: r.accepted });
      return r;
    }),
  };
});
vi.mock('@fiks/repair', async (orig) => {
  const m = await orig<typeof import('@fiks/repair')>();
  return {
    ...m,
    stubRunner: (s: StubScript) => {
      const r = m.stubRunner(s);
      return {
        ...r,
        run(job: RunnerJob, signal: AbortSignal) {
          spies.jobs.push({
            traceFormat: job.traceFormat,
            prompt: job.prompt,
            allowedEditPaths: job.allowedEditPaths,
            backend: job.backend,
          });
          return r.run(job, signal);
        },
      };
    },
  };
});

const out = mkdtempSync(join(tmpdir(), 'fiks-orch-cu-'));
const scratch = mkdtempSync(join(tmpdir(), 'fiks-orch-cu-scratch-'));
const CORPUS = join(ORCH_FIXTURES, 'clean-v1');

/** A stub session that ends with a contract update replacing items.price.range. */
function widen(max: number, rationale: string) {
  const inv = {
    id: 'items.price.range',
    kind: 'range',
    path: 'items[*].price',
    min: 20,
    max,
    unit: 'USD',
  };
  const outcome = {
    outcome: 'contract_update',
    delta: {
      ops: [{ op: 'replaceInvariant', contractId: 'shop.search_products', invariant: inv }],
      rationale,
    },
  };
  return {
    steps: [],
    summary: `Subject: widen the search price range\n\n\`\`\`json\n${JSON.stringify(outcome)}\n\`\`\``,
  };
}

describe.runIf(E2E)('FIKS+CU with stub agents', () => {
  test(
    'BEN-DEV-1: a widening contract update is accepted -> proposal, contract_update_proposed, no would_open_pr',
    async () => {
      const before = spies.acceptDelta.length;
      const stub = join(scratch, 'ben.json');
      writeFileSync(
        stub,
        JSON.stringify(
          script(
            widen(
              3000,
              'The vendor now sells a premium laptop at 2,500 USD; prices up to 3,000 USD are legitimate.',
            ),
          ),
        ),
      );
      const r = await runArm({
        arm: 'fiks+cu',
        runKey: 'orch-test/fiks+cu/stub/shop/BEN-DEV-1/1',
        traceFile: join(ORCH_FIXTURES, 'BEN-DEV-1.trace.json'),
        base: 'base-shop',
        rule: join(ORCH_FIXTURES, 'BEN-DEV-1.json'),
        cleanCorpus: CORPUS,
        agentStub: stub,
        toolsImage: await toolsImage(),
        testTools: true,
        outRoot: out,
      });
      expect(r.status, r.reason).toBe('contract_update_proposed');
      expect(r.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(['F:true']);
      const calls = spies.acceptDelta.slice(before);
      expect(calls).toHaveLength(1);
      const ctx = (calls[0] as (typeof calls)[number]).ctx;
      expect(ctx.storedViolations.length).toBeGreaterThan(0);
      expect(ctx.cleanCorpus.length).toBeGreaterThan(0);
      expect(ctx.mutationVariants.length).toBeGreaterThan(0);
      expect((ctx.trigger as { id: string }).id).toBe(r.traceId);
      expect(calls[0]?.accepted).toBe(true);
      const proposal = join(r.dir, 'proposal', 'proposal.md');
      expect(existsSync(proposal)).toBe(true);
      expect(readFileSync(proposal, 'utf8')).toMatch(/# Contract update proposal/);
      const proposed = JSON.parse(
        readFileSync(join(r.dir, 'proposal', 'proposed.contracts.json'), 'utf8'),
      ) as ContractFile;
      const range = proposed.contracts
        .find((c) => c.id === 'shop.search_products')
        ?.invariants?.find((i) => i.id === 'items.price.range') as { max: number };
      expect(range.max).toBe(3000);
      const attempt = JSON.parse(readFileSync(join(r.dir, 'attempt.json'), 'utf8'));
      expect(attempt.outcome).toBe('contract_update_proposed');
      expect(attempt.prExposed).toBe(false);
      const events = readJsonl<{ type: string }>(join(r.dir, 'events.jsonl'));
      expect(events.some((e) => e.type === 'would_open_pr')).toBe(false);
      expect(r.wouldOpenPr).toBeUndefined();
    },
    ARM_TIMEOUT,
  );

  test(
    'D1: a silencing delta is rejected, the reasons reach the next session, then code repair -> would_open_pr',
    async () => {
      const before = spies.acceptDelta.length;
      const pkg = join(ROOT, 'packages/injector/fixtures/driftpkgs/D1.json');
      const tracePath = join(scratch, 'D1.trace.json');
      writeFileSync(tracePath, await traceThroughRule({ domain: 'shop', rule: pkg, ref: 'seed-v1' }));
      const fix = sessionFromPatch(repoDir('shop'), 'seed-v1', join(ORACLES, 'D1.patch'));
      const stub = join(scratch, 'd1.json');
      writeFileSync(
        stub,
        JSON.stringify(script(widen(100_000_000, 'Prices are now reported this way.'), fix)),
      );
      const r = await runArm({
        arm: 'fiks+cu',
        runKey: 'orch-test/fiks+cu/stub/shop/D1/1',
        traceFile: tracePath,
        base: 'seed-v1',
        rule: pkg,
        cleanCorpus: CORPUS,
        storedTraces: [join(ROOT, 'packages/contract-update/test/fixtures/traces')],
        agentStub: stub,
        toolsImage: await toolsImage(),
        testTools: true,
        outRoot: out,
      });
      const calls = spies.acceptDelta.slice(before);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.accepted).toBe(false);
      const cu = r.contractUpdate ?? [];
      expect(cu).toHaveLength(1);
      expect(cu[0]?.accepted).toBe(false);
      expect(cu[0]?.reasons.join('\n')).toMatch(
        /no longer violates shop\.search_products\/items\.price\.range/,
      );
      const next = readFileSync(join(r.dir, 'sessions', '2.prompt.md'), 'utf8');
      for (const reason of cu[0]?.reasons ?? []) expect(next).toContain(reason);
      expect(r.status, r.reason).toBe('would_open_pr');
      expect(r.sessions).toBe(2);
      expect(r.gates.map((g) => `${g.gate}:${g.ok}`)).toEqual(
        ['F', 'P', 'suite', 'traces', 'typecheck', 'lint', 'ci-local'].map((g) => `${g}:true`),
      );
      const ev = readJsonl<{ type: string; ok?: boolean }>(join(r.dir, 'events.jsonl'));
      const ci = ev.findIndex((e) => e.type === 'gate_ci-local' && e.ok === true);
      expect(ci).toBeGreaterThan(-1);
      expect(ev.findIndex((e) => e.type === 'would_open_pr')).toBeGreaterThan(ci);
      expect(existsSync(join(r.dir, 'proposal'))).toBe(false);
      // The contracts in force were the base's vendored ones.
      expect(contractsAt('shop', 'seed-v1').contracts.length).toBeGreaterThan(0);
    },
    ARM_TIMEOUT,
  );

  test(
    "--trace-format strict reaches SAFE's runner options through `fiks repair`",
    async () => {
      const before = spies.jobs.length;
      const stub = join(scratch, 'noop.json');
      writeFileSync(stub, JSON.stringify(script({ steps: [], summary: 'Subject: nothing\nNo change.' })));
      const code = await command.run([
        '--arm',
        'fiks',
        '--run-key',
        'orch-test/fiks/stub/shop/D2-strict/1',
        '--trace',
        join(ROOT, 'packages/cli/test/core/fixtures/D2-trace.json'),
        '--base',
        'seed-v1',
        '--trace-format',
        'strict',
        '--agent-stub',
        stub,
        '--max-sessions',
        '1',
        '--f-runs',
        '1',
        '--tools-image',
        await toolsImage(),
        '--test-tools',
        '--out',
        out,
      ]);
      expect(code).toBe(1);
      const jobs = spies.jobs.slice(before);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.traceFormat).toBe('strict');
      expect(jobs[0]?.prompt).toMatch(/Typed trace \(strict format\)/);
      expect(jobs[0]?.allowedEditPaths).toEqual(['^src/.+\\.ts$']);
      expect(jobs[0]?.backend).toBeDefined();
      const attempt = JSON.parse(
        readFileSync(join(out, 'orch-test/fiks/stub/shop/D2-strict/1/attempt.json'), 'utf8'),
      );
      expect(attempt.traceFormat).toBe('strict');
    },
    ARM_TIMEOUT,
  );
});
