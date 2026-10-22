// Worktree ops under a file lock (PLAN P6): 4 processes with distinct FIKS_DIR run 20
// create/remove cycles against one repository concurrently; git stays consistent.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { ROOT, TSX } from './support/cli.ts';

const SHOP = join(ROOT, '.work/shop-mcp');
const tmp = mkdtempSync(join(tmpdir(), 'fiks-wt-lock-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function worker(repo: string, id: number, cycles: number) {
  const fiksDir = mkdtempSync(join(tmp, `fiks-dir-${id}-`));
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(
      TSX,
      [join(ROOT, 'packages/cli/test/core/support/wt-worker.ts'), repo, String(cycles), String(id)],
      {
        env: { ...process.env, FIKS_DIR: fiksDir },
      },
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

test('20 concurrent create/remove cycles from 4 processes with distinct FIKS_DIR; git fsck clean', async () => {
  const repo = join(tmp, 'repo');
  execFileSync('git', ['clone', '-q', '--no-checkout', SHOP, repo]);
  const results = await Promise.all([0, 1, 2, 3].map((id) => worker(repo, id, 5)));
  for (const [id, r] of results.entries()) {
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`worker ${id}: 5 cycles ok`);
  }
  const fsck = execFileSync('git', ['fsck', '--full', '--no-dangling'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  expect(fsck).not.toMatch(/error|broken|missing/i);
  // No worktree left behind and no stale lock.
  const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  expect(list.match(/^worktree /gm)).toHaveLength(1);
  expect(execFileSync('git', ['worktree', 'prune', '--dry-run', '-v'], { cwd: repo, encoding: 'utf8' })).toBe(
    '',
  );
  expect(() => execFileSync('ls', [join(repo, '.git/fiks-worktree.lock')], { stdio: 'pipe' })).toThrow();
}, 300_000);
