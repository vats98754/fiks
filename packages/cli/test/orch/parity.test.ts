// F and P in the container give the same verdicts and messages as on the host (D1-D5): the same
// CORE gate code runs on a suite run inside the per-attempt container (the worktree is mounted at
// its host path, so file names and messages line up). Opt-in: FIKS_ORCH_E2E=1.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateResult, Trace } from '@fiks/repro';
import { createWorktree, failGate, generateRepro, passGate } from '@fiks/repro';
import { buildRepoImage, DockerExecBackend } from '@fiks/sandbox';
import { describe, expect, test } from 'vitest';
import { registerSandboxDomain, syncContainer } from '../../src/commands/repair.ts';
import { rerecordStale } from '../../src/commands/rerecord-stale.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { E2E, ORACLES } from './support/arm.ts';

const TRACES = join(ROOT, 'packages/contract-update/test/fixtures/traces');
const DRIFTS: Record<string, string> = {
  D1: 'D1-tr_b47c5b77c6.json',
  D2: 'D2-tr_079b90c89e.json',
  D3: 'D3-tr_7280855590.json',
  D4: 'D4-tr_d02358451e.json',
  D5: 'D5-tr_4db46c86e4.json',
};

/**
 * Vitest's own stack frames name where node_modules lives: on the host the worktree's symlink
 * resolves to the clone's install, in the container it is the image's install mounted at
 * <worktree>/node_modules. That location is the only allowed difference.
 */
const NODE_MODULES = /(?:file:\/\/)?\/[^\s"')]*?\/node_modules\//g;
const normal = (m: string) => m.replace(NODE_MODULES, '<node_modules>/');

/** What must be identical: verdict, reason and every failing test's file, name and message. */
const view = (g: GateResult) => ({
  ok: g.ok,
  reason: g.reason,
  failed: g.evidence.failed.map((f) => ({ file: f.file, test: f.test, message: normal(f.message) })),
});

async function inContainer<T>(wt: string, image: string, fn: (domainId: string) => T): Promise<T> {
  const b = new DockerExecBackend({ worktree: wt, image, workdir: wt });
  try {
    await b.start();
    return fn(
      registerSandboxDomain(
        'shop',
        syncContainer(b.name, join(mkdtempSync(join(tmpdir(), 'egr-')), 'e.jsonl')),
      ),
    );
  } finally {
    await b.cleanup();
  }
}

describe.runIf(E2E)('F and P: host vs container', () => {
  for (const [drift, file] of Object.entries(DRIFTS)) {
    test(
      `${drift}: identical F and P verdicts and messages`,
      async () => {
        const repo = repoDir('shop');
        const image = (await buildRepoImage({ repo, ref: 'seed-v1' })).digest;
        const wt = createWorktree(repo, 'seed-v1', { parent: mkdtempSync(join(tmpdir(), 'fiks-parity-')) });
        try {
          const dir = realpathSync(wt.dir);
          const tracePath = join(TRACES, file);
          const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as Trace;
          const spec = generateRepro(trace, tracePath, dir, 'shop');
          const hostF = failGate(dir, spec, 1, 'shop');
          const boxF = await inContainer(dir, image, (id) => failGate(dir, spec, 1, id));
          expect(hostF.ok, hostF.reason).toBe(true);
          expect(view(boxF)).toEqual(view(hostF));

          execFileSync('git', ['apply', join(ORACLES, `${drift}.patch`)], { cwd: dir });
          // fiks re-records what the fix legitimately changed (D3, D4), on the host here: this test
          // compares the gate verdicts on identical trees, not where re-recording runs.
          await rerecordStale(dir, {});
          const hostP = passGate(dir, spec, 'shop');
          const boxP = await inContainer(dir, image, (id) => passGate(dir, spec, id));
          expect(hostP.ok, hostP.reason).toBe(true);
          expect(view(boxP)).toEqual(view(hostP));
        } finally {
          wt.remove();
        }
      },
      20 * 60_000,
    );
  }
});
