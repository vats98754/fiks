// rerecord-head is container-runnable (PLAN P1/P23, round 6): `--require-sandbox` exits 2 on the
// host; with FIKS_IN_SANDBOX=1 and a temp HOME it runs and never reads the checkout's .env.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree, FS_READ_LOG_PRELOAD } from '@fiks/repro';
import { afterAll, expect, test } from 'vitest';
import { shopDir } from '../../src/paths.ts';
import { ROOT, runCli } from './support/cli.ts';

const tmp = mkdtempSync(join(tmpdir(), 'fiks-sandbox-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const PROFILE = JSON.stringify({ domain: 'shop', base: 'v1', ruleId: null, ruleHash: null });

test('--require-sandbox on the host exits 2 with "sandbox required"', () => {
  const env = { FIKS_IN_SANDBOX: '' };
  const r = runCli(
    [
      'rerecord-head',
      '--require-sandbox',
      '--worktree',
      tmp,
      '--profile',
      PROFILE,
      '--from',
      'HEAD',
      '--log',
      join(tmp, 'x.jsonl'),
    ],
    { env },
  );
  expect(r.status).toBe(2);
  expect(r.stderr).toMatch(/sandbox required/);
  expect(existsSync(join(tmp, 'x.jsonl'))).toBe(false);
}, 60_000);

// PLAN §0.B BA2: the acceptance form is `pnpm --reporter=default fiks ...` (the root .npmrc
// `reporter=silent` makes pnpm report every non-zero child exit as 1).
test('pnpm --reporter=default fiks rerecord-head --require-sandbox on the host exits 2', () => {
  const r = spawnSync(
    'pnpm',
    [
      '--reporter=default',
      'fiks',
      'rerecord-head',
      '--require-sandbox',
      '--worktree',
      tmp,
      '--profile',
      PROFILE,
      '--from',
      'HEAD',
      '--log',
      join(tmp, 'y.jsonl'),
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FIKS_IN_SANDBOX: '' } },
  );
  expect(r.error).toBeUndefined();
  expect(r.status, r.stderr).toBe(2);
  expect(`${r.stdout}${r.stderr}`).toMatch(/sandbox required/);
  expect(existsSync(join(tmp, 'y.jsonl'))).toBe(false);
}, 60_000);

test('with FIKS_IN_SANDBOX=1 and a temp HOME it runs; an fs spy shows no read of the checkout .env', () => {
  const envFile = join(ROOT, '.env');
  // A real .env (e.g. a symlink for [LIVE] items) is left alone; otherwise plant a dummy one.
  const planted = !existsSync(envFile);
  if (planted) writeFileSync(envFile, 'FIKS_SANDBOX_TEST_DUMMY=1\n');
  const wt = createWorktree(shopDir(), 'seed-v1', { dir: join(tmp, 'wt') });
  try {
    const spy = (name: string) => join(tmp, `${name}.reads.log`);
    const home = mkdtempSync(join(tmp, 'home-'));
    const env = (log: string) => ({
      FIKS_IN_SANDBOX: '1',
      HOME: home,
      NODE_OPTIONS: `--require ${FS_READ_LOG_PRELOAD}`,
      FIKS_FS_READ_LOG: log,
    });
    const args = [
      '--worktree',
      wt.dir,
      '--profile',
      PROFILE,
      '--from',
      'HEAD',
      '--log',
      join(tmp, 'sandboxed.jsonl'),
    ];
    const r = runCli(['rerecord-head', '--require-sandbox', ...args], { env: env(spy('sandboxed')) });
    expect(r.status, r.stderr).toBe(0);
    const line = JSON.parse(readFileSync(join(tmp, 'sandboxed.jsonl'), 'utf8').trim());
    expect(line.files).toEqual([]); // seed-v1 is consistent: nothing stale, nothing to overlay
    const reads = readFileSync(spy('sandboxed'), 'utf8').split('\n');
    expect(reads.length).toBeGreaterThan(10); // the spy saw the run (sources, recordings, ...)
    expect(reads).not.toContain(envFile);
    expect(reads.filter((p) => p.endsWith('/.env'))).toEqual([]);
    // Control: the same run without --require-sandbox reads the .env, and the spy sees it.
    const c = runCli(['rerecord-head', '--help'], { env: env(spy('host')) });
    expect(c.status).toBe(0);
    expect(readFileSync(spy('host'), 'utf8').split('\n')).toContain(envFile);
  } finally {
    wt.remove();
    if (planted) rmSync(envFile, { force: true });
  }
}, 300_000);
