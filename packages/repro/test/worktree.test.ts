// createWorktree (PLAN P17): local refs resolved as <ref>^{commit}, never a fetch.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createWorktree, resolveLocalRef } from '../src/index.ts';

// git worktree add checks out a whole tree; under a busy suite that takes seconds.
vi.setConfig({ testTimeout: 60_000 });

const SHOP = new URL('../../../.work/shop-mcp', import.meta.url).pathname;
const SEED_V1 = 'bb037cf8ac313d2ad2c5d683476a527a9147e1c7';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let tmp: string;
let repo: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fiks-repro-wt-'));
  repo = join(tmp, 'clone');
  // A local clone of the shop-mcp clone (tags included), with an origin nobody can reach.
  git(tmp, 'clone', '-q', '--no-checkout', SHOP, repo);
  git(repo, 'remote', 'set-url', 'origin', 'https://invalid.example/x.git');
  git(repo, 'tag', '-a', 'test-annotated', '-m', 'annotated test tag', `${SEED_V1}~1`);
  git(repo, 'tag', 'test-light', `${SEED_V1}~2`);
  git(repo, 'branch', 'test-branch', `${SEED_V1}~3`);
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test('seed-v1 resolves to its peeled commit and is checked out with no fetch (GIT_TRACE)', () => {
  expect(git(repo, 'remote', 'get-url', 'origin')).toBe('https://invalid.example/x.git');
  expect(git(repo, 'cat-file', '-t', 'seed-v1')).toBe('tag'); // annotated: needs peeling
  const trace = join(tmp, 'git-trace.log');
  const saved = process.env.GIT_TRACE;
  process.env.GIT_TRACE = trace;
  let wt: ReturnType<typeof createWorktree> | undefined;
  try {
    wt = createWorktree(repo, 'seed-v1', { dir: join(tmp, 'wt-seed') });
  } finally {
    if (saved === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = saved;
  }
  try {
    expect(wt.commit).toBe(git(repo, 'rev-parse', 'seed-v1^{commit}'));
    expect(wt.commit).toBe(SEED_V1);
    expect(git(wt.dir, 'rev-parse', 'HEAD')).toBe(SEED_V1);
    const log = readFileSync(trace, 'utf8');
    expect(log).toMatch(/git(\.exe)?['"]? (rev-parse|worktree)/); // the trace did record git calls
    expect(log).not.toMatch(/\bfetch\b|remote-https|ls-remote|upload-pack/);
  } finally {
    wt.remove();
  }
  expect(existsSync(join(tmp, 'wt-seed'))).toBe(false);
});

test('an annotated tag resolves to its peeled commit; lightweight tags and branches work too', () => {
  for (const [ref, want] of [
    ['test-annotated', `${SEED_V1}~1`],
    ['test-light', `${SEED_V1}~2`],
    ['test-branch', `${SEED_V1}~3`],
  ] as const) {
    const commit = git(repo, 'rev-parse', `${want}`);
    expect(resolveLocalRef(repo, ref)).toBe(commit);
    const wt = createWorktree(repo, ref, { linkNodeModules: false });
    try {
      expect(git(wt.dir, 'rev-parse', 'HEAD')).toBe(commit);
    } finally {
      wt.remove();
    }
  }
  expect(git(repo, 'rev-parse', 'test-annotated')).not.toBe(
    git(repo, 'rev-parse', 'test-annotated^{commit}'),
  );
});

test('an unknown ref exits with a clear error and creates nothing', () => {
  const dir = join(tmp, 'wt-unknown');
  expect(() => createWorktree(repo, 'no-such-ref', { dir })).toThrow(
    /unknown ref "no-such-ref" .*no local branch, tag or commit/,
  );
  expect(existsSync(dir)).toBe(false);
  expect(() => createWorktree(repo, '--upload-pack=x')).toThrow(/invalid ref/);
});

test('--fetch is refused with a run key', () => {
  expect(() => createWorktree(repo, 'seed-v1', { fetch: true, runKey: 'e/a/m/shop/D1/1' })).toThrow(
    /--fetch is refused with a run key/,
  );
});

test('without dir, each call gets its own fresh directory under parent; remove() deletes it (P6)', () => {
  const parent = join(tmp, 'wt-parent');
  const a = createWorktree(repo, 'seed-v1', { parent, prefix: 'repro-same-', linkNodeModules: false });
  const b = createWorktree(repo, 'seed-v1', { parent, prefix: 'repro-same-', linkNodeModules: false });
  try {
    expect(a.dir).not.toBe(b.dir);
    expect(a.dir).toMatch(new RegExp(`^${parent}/repro-same-[^/]+/repo$`));
    expect(git(a.dir, 'rev-parse', 'HEAD')).toBe(SEED_V1);
    expect(git(b.dir, 'rev-parse', 'HEAD')).toBe(SEED_V1);
    a.remove();
    // Removing one leaves the other intact.
    expect(git(b.dir, 'rev-parse', 'HEAD')).toBe(SEED_V1);
  } finally {
    b.remove();
  }
  expect(readdirSync(parent)).toEqual([]);
});
