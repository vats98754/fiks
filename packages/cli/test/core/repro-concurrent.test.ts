// Concurrent `fiks repro` on one trace (PLAN P6): processes with their own FIKS_DIR but the
// same FIKS_WORK_DIR and tool repo each get their own worktree, so none deletes another's live
// worktree mid-gate. (Before the fix the worktree path depended only on the trace id: one run
// exited 1 with ENOENT and the other with "fatal: '.../wt/repro-<id>' already exists".)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { shopDir, WORK_DIR } from '../../src/paths.ts';
import { ROOT, TSX } from './support/cli.ts';

const D2 = new URL('./fixtures/D2-trace.json', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'fiks-repro-concurrent-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function reproProcess(id: number, delayMs: number): Promise<Run> {
  const fiksDir = mkdtempSync(join(tmp, `fiks-dir-${id}-`));
  return new Promise((resolve) => {
    setTimeout(() => {
      const child = spawn(
        TSX,
        [join(ROOT, 'packages/cli/src/main.ts'), 'repro', '--trace', D2, '--runs', '2', '--json'],
        { cwd: ROOT, env: { ...process.env, FIKS_DIR: fiksDir } },
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.stderr.on('data', (d) => {
        err += d;
      });
      child.on('exit', (code) => resolve({ code, out, err }));
    }, delayMs);
  });
}

test('3 concurrent repro runs on the same trace (distinct FIKS_DIR, shared work dir) all pass the F gate', async () => {
  // Staggered starts: later runs set up their worktree while earlier ones are inside the gate.
  const runs = await Promise.all([0, 1, 2].map((id) => reproProcess(id, id * 1500)));
  const dirs = new Set<string>();
  for (const [id, r] of runs.entries()) {
    expect(r.code, `run ${id}: ${r.err}`).toBe(0);
    const res = JSON.parse(r.out) as {
      gateF: { ok: boolean; reason: string };
      spec: { propertyIds: string[] };
      trace: { id: string };
    };
    expect(res.gateF.ok, res.gateF.reason).toBe(true);
    expect(res.spec.propertyIds).toEqual(['shop.get_product/price.notNull']);
    expect(res.trace.id).toBe('tr_079b90c89e');
    // The failing assertion names the recording inside that run's worktree.
    const m = /\(([^()]*\/repo)\/test\/repro\/tr_079b90c89e\.json\)/.exec(JSON.stringify(res.gateF));
    expect(m?.[1], r.out).toMatch(/\/wt\/repro-tr_079b90c89e-[^/]+\/repo$/);
    dirs.add(m?.[1] as string);
  }
  // Each process worked in its own directory.
  expect(dirs.size).toBe(runs.length);
  // Every worktree was removed with its directory, and git holds no stale entry.
  const wt = join(WORK_DIR, 'wt');
  const left = existsSync(wt) ? readdirSync(wt).filter((n) => n.startsWith('repro-tr_079b90c89e')) : [];
  expect(left).toEqual([]);
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: shopDir(), encoding: 'utf8' });
  expect(list).not.toMatch(/repro-tr_079b90c89e/);
}, 300_000);
