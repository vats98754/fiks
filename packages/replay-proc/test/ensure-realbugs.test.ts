// scripts/ensure-realbugs.mjs (PLAN 5.10): URL resolution from pins.json `repo`, and an
// idempotent clone into the gitignored .work/realbugs/<id> from a local bare repo.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'scripts/ensure-realbugs.mjs');
// The script is plain ESM without types; the test reads only what it calls.
const mod = (await import(SCRIPT)) as {
  resolveRemote(pins: unknown, id: string, env?: Record<string, string>): string;
  remoteEnvName(id: string): string;
};

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function run(args: string[], env: Record<string, string> = {}) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('FIKS_REALBUG_') && !k.startsWith('GIT_')),
  );
  return spawnSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...clean, ...env } });
}

function pinsDir(id: string, pins: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-rbx-pins-'));
  mkdirSync(join(dir, id));
  writeFileSync(join(dir, id, 'pins.json'), JSON.stringify(pins));
  return dir;
}

describe('URL resolution (no network)', () => {
  test('repo vats98754/rb-r10-servers resolves to its GitHub https URL', () => {
    const pins = { repo: 'vats98754/rb-r10-servers', prefixSha: SHA_A, fixSha: SHA_B };
    expect(mod.resolveRemote(pins, 'R10', {})).toBe('https://github.com/vats98754/rb-r10-servers.git');
    for (const repo of [
      'vats98754/rb-r19-mongodb-mcp-server',
      'vats98754/rb-r19r-servers',
      'vats98754/rb-r20-figma-context-mcp',
      'vats98754/rb-r9-mcp-server-cloudflare',
    ]) {
      expect(mod.resolveRemote({ ...pins, repo }, 'X', {})).toBe(`https://github.com/${repo}.git`);
    }
    expect(mod.remoteEnvName('r10')).toBe('FIKS_REALBUG_REMOTE_R10');
    expect(mod.resolveRemote(pins, 'r10', { FIKS_REALBUG_REMOTE_R10: '/tmp/x.git' })).toBe('/tmp/x.git');
  });

  test('a pins.json without repo, or with another owner, exits 2', () => {
    for (const pins of [
      { prefixSha: SHA_A, fixSha: SHA_B },
      { repo: 'someone/rb-r10-servers', prefixSha: SHA_A, fixSha: SHA_B },
      { repo: 'rb-r10-servers', prefixSha: SHA_A, fixSha: SHA_B },
    ]) {
      const dir = pinsDir('R10', pins);
      try {
        // Even with an override URL set, the repo field must be valid.
        const r = run(['--id', 'R10', '--pins-dir', dir], { FIKS_REALBUG_REMOTE_R10: '/nonexistent.git' });
        expect(r.status, `${JSON.stringify(pins)}: ${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/no 'repo' field|not owned by vats98754|not <owner>\/<name>/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(run([]).status).toBe(2);
    expect(run(['--all', '--id', 'R10']).status).toBe(2);
  });
});

describe('clone into .work/realbugs/T1 from a local bare repo', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=fiks-test', '-c', 'user.email=t@example.invalid', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();
  const clone = join(ROOT, '.work/realbugs/T1');
  let tmp: string;
  let bare: string;
  let prefix: string;
  let fix: string;
  let pins: string;

  beforeAll(() => {
    if (existsSync(clone)) throw new Error(`${clone} exists already; remove it before this test`);
    tmp = mkdtempSync(join(tmpdir(), 'fiks-rbx-realbug-'));
    const src = join(tmp, 'src');
    mkdirSync(src);
    git(src, 'init', '-q', '-b', 'main');
    writeFileSync(join(src, 'server.ts'), 'export const bug = true;\n');
    git(src, 'add', '.');
    git(src, 'commit', '-q', '-m', 'prefix');
    prefix = git(src, 'rev-parse', 'HEAD');
    writeFileSync(join(src, 'server.ts'), 'export const bug = false;\n');
    git(src, 'commit', '-q', '-am', 'fix');
    fix = git(src, 'rev-parse', 'HEAD');
    git(src, 'reset', '-q', '--hard', prefix);
    bare = join(tmp, 'rb-t1.git');
    git(tmp, 'clone', '-q', '--bare', src, bare);
    // The fix exists only under a pull ref, as for an unmerged upstream PR: a plain clone lacks it.
    git(bare, 'update-ref', 'refs/pull/1/head', fix);
    pins = pinsDir('T1', { repo: 'vats98754/rb-t1-test', prefixSha: prefix, fixSha: fix, bug: 'T1' });
  }, 60_000);
  afterAll(() => {
    rmSync(clone, { recursive: true, force: true });
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (pins) rmSync(pins, { recursive: true, force: true });
  });

  test('creates the clone with tags at the pinned SHAs; a second run makes no fetch', () => {
    const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    const before = status();
    const trace1 = join(tmp, 'trace1.log');
    // file:// so git uses its transport (a plain path would hard-link every object, fix included).
    const url = `file://${bare}`;
    const env = { FIKS_REALBUG_REMOTE_T1: url };
    const r1 = run(['--id', 'T1', '--pins-dir', pins], { ...env, GIT_TRACE: trace1 });
    expect(r1.status, r1.stderr).toBe(0);
    const did1 = JSON.parse(r1.stdout.trim());
    expect(did1).toMatchObject({ id: 'T1', cloned: true, fetched: ['fix'], tagged: ['prefix', 'fix'] });
    expect(readFileSync(trace1, 'utf8')).toMatch(/built-in: git (clone|fetch)/);

    expect(git(clone, 'rev-parse', 'prefix^{commit}')).toBe(prefix);
    expect(git(clone, 'rev-parse', 'fix^{commit}')).toBe(fix);
    expect(git(clone, 'remote')).toBe('origin');
    expect(git(clone, 'remote', 'get-url', 'origin')).toBe(url);

    const trace2 = join(tmp, 'trace2.log');
    const r2 = run(['--id', 'T1', '--pins-dir', pins], { ...env, GIT_TRACE: trace2 });
    expect(r2.status, r2.stderr).toBe(0);
    expect(JSON.parse(r2.stdout.trim())).toMatchObject({ cloned: false, fetched: [], tagged: [] });
    const t2 = readFileSync(trace2, 'utf8');
    expect(t2).toMatch(/built-in: git/); // the trace was written
    expect(t2).not.toMatch(/git (clone|fetch|ls-remote|remote-)|upload-pack/);

    // --all over the same pins dir is a no-op too.
    const r3 = run(['--all', '--pins-dir', pins], env);
    expect(r3.status, r3.stderr).toBe(0);
    expect(JSON.parse(r3.stdout.trim())).toMatchObject({ id: 'T1', cloned: false, fetched: [] });

    expect(spawnSync('git', ['check-ignore', '-q', '.work/realbugs/T1'], { cwd: ROOT }).status).toBe(0);
    expect(status()).toBe(before);
    // git-heavy: 1.5 s alone, over the 5 s default under full-suite load
  }, 60_000);
});
