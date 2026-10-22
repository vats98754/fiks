// Unit tests: no Docker. ciLocal/runPreGate run against a scripted ExecBackend.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecBackend, ExecOptions, ExecResult } from '@fiks/interfaces';
import { afterAll, describe, expect, test } from 'vitest';
import {
  assertAllowedRepo,
  branchFor,
  slugFromRemote,
  summarize as summarizeAgreement,
} from '../src/agreement.ts';
import {
  assertSafeEnv,
  DockerExecBackend,
  egressDenials,
  mountSpec,
  parsePushLog,
  SANDBOX_ENV,
} from '../src/backend.ts';
import { lockImporters, manifestHash } from '../src/build.ts';
import { forbiddenEntries } from '../src/build-tools.ts';
import { ciLocal, hermetic, parseWorkflow, runPreGate } from '../src/ci-local.ts';
import { ancestry, withLock } from '../src/lock.ts';
import { installGitShim, realGit } from '../src/shim.ts';
import { FIKS_SANDBOX_ENV } from '../src/tools.ts';

const tmp = mkdtempSync(join(tmpdir(), 'fiks-sbx-unit-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// shop-mcp's .github/workflows/ci.yml (7bf2e66), verbatim.
const SHOP_CI = `name: CI

on:
  push:
    branches: ['**']
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
`;

describe('workflow mirroring', () => {
  test('shop-mcp ci.yml: three setup actions, then the four run steps in order', () => {
    const steps = parseWorkflow(SHOP_CI);
    expect(steps.map((s) => s.uses ?? s.run)).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0',
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
    ]);
    expect(new Set(steps.map((s) => s.job))).toEqual(new Set(['check']));
  });

  test('block scalars, names and several jobs', () => {
    const yml = `jobs:
  a:
    steps:
      - name: Install
        run: |
          pnpm i --frozen-lockfile
          echo done
      - run: "pnpm test"
  b:
    runs-on: x
    steps:
    - name: folded
      run: >
        echo one
        two
`;
    const steps = parseWorkflow(yml);
    expect(steps).toEqual([
      { job: 'a', name: 'Install', run: 'pnpm i --frozen-lockfile\necho done' },
      { job: 'a', name: '', run: 'pnpm test' },
      { job: 'b', name: 'folded', run: 'echo one two' },
    ]);
  });

  test('pnpm install is forced offline, nothing else changes', () => {
    expect(hermetic('pnpm install --frozen-lockfile')).toBe('pnpm install --frozen-lockfile --offline');
    expect(hermetic('pnpm i\npnpm test')).toBe('pnpm i --offline\npnpm test');
    expect(hermetic('pnpm install --offline')).toBe('pnpm install --offline');
    expect(hermetic('pnpm typecheck')).toBe('pnpm typecheck');
  });
});

/** Scripted backend: `bash -e -c <script>` returns what the table says for that script. */
class FakeBackend implements ExecBackend {
  calls: string[] = [];
  constructor(private readonly table: Record<string, ExecResult>) {}
  async exec(cmd: string, args: string[], _opts?: ExecOptions): Promise<ExecResult> {
    const script = cmd === 'bash' ? (args[2] ?? '') : [cmd, ...args].join(' ');
    this.calls.push(script);
    return this.table[script] ?? { code: 0, stdout: `ok: ${script}\n`, stderr: '' };
  }
  async cleanup() {}
}

describe('ciLocal / runPreGate verdicts (scripted backend)', () => {
  const wt = join(tmp, 'wt');
  mkdirSync(join(wt, '.github/workflows'), { recursive: true });
  writeFileSync(join(wt, '.github/workflows/ci.yml'), SHOP_CI);
  const failing = 'node fiks-iv.js --trace t.json';
  const table = {
    [failing]: { code: 1, stdout: '', stderr: 'IV: shop.get_product/price.notNull violated\n' },
  };

  test('an extra check that exits 1 makes ciLocal red, with its output in the log', async () => {
    const backend = new FakeBackend(table);
    const r = await ciLocal(wt, 'img', [failing], { backend });
    expect(r.green).toBe(false);
    expect(r.log).toContain('IV: shop.get_product/price.notNull violated');
    expect(r.steps.filter((s) => s.kind === 'ci').every((s) => s.status === 'pass')).toBe(true);
    expect(backend.calls).toEqual([
      'pnpm install --frozen-lockfile --offline',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      failing,
    ]);
  });

  test('runPreGate runs only the checks and is red on the same failing check', async () => {
    const backend = new FakeBackend(table);
    const r = await runPreGate(wt, 'img', [{ name: 'issue validation', run: failing }], { backend });
    expect(r.green).toBe(false);
    expect(r.log).toContain('IV: shop.get_product/price.notNull violated');
    expect(backend.calls).toEqual([failing]);
  });

  test('a failing CI step skips later CI steps (as Actions does) but extra checks still run', async () => {
    const backend = new FakeBackend({ 'pnpm typecheck': { code: 2, stdout: 'TS2322', stderr: '' } });
    const r = await ciLocal(wt, 'img', ['true'], { backend });
    expect(r.green).toBe(false);
    expect(r.steps.map((s) => s.status)).toEqual([
      'image',
      'image',
      'image',
      'pass',
      'fail',
      'skipped',
      'skipped',
      'pass',
    ]);
    expect(backend.calls).toEqual(['pnpm install --frozen-lockfile --offline', 'pnpm typecheck', 'true']);
  });

  test('all green', async () => {
    const r = await ciLocal(wt, 'img', [], { backend: new FakeBackend({}) });
    expect(r.green).toBe(true);
    const p = await runPreGate(wt, 'img', ['true'], { backend: new FakeBackend({}) });
    expect(p.green).toBe(true);
  });
});

describe('backend pieces', () => {
  test('secret-looking variables never enter a sandbox', () => {
    for (const k of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'FIKS_CANARY',
    ]) {
      expect(() => assertSafeEnv({ ...SANDBOX_ENV, [k]: 'x' })).toThrow(k);
    }
    expect(() => assertSafeEnv(FIKS_SANDBOX_ENV)).not.toThrow();
    expect(Object.keys(FIKS_SANDBOX_ENV).sort()).toEqual([
      'CI',
      'FIKS_DIR',
      'FIKS_IN_SANDBOX',
      'HOME',
      'PATH',
    ]);
    expect(FIKS_SANDBOX_ENV).toMatchObject({
      CI: '1',
      HOME: '/tmp',
      FIKS_DIR: '/tmp/fiks',
      FIKS_IN_SANDBOX: '1',
    });
  });

  test('host paths map into the container only from inside the worktree', () => {
    const wt = join(tmp, 'map');
    mkdirSync(join(wt, 'src'), { recursive: true });
    const b = new DockerExecBackend({ worktree: wt, image: 'x', workdir: '/w' });
    expect(b.containerPath(join(wt, 'src'))).toBe('/w/src');
    expect(b.containerPath('src/new.ts')).toBe('/w/src/new.ts');
    expect(b.containerPath(wt)).toBe('/w');
    expect(() => b.containerPath('/etc')).toThrow(/outside/);
    expect(() => b.containerPath(join(wt, '..'))).toThrow(/outside/);
  });

  test('mount specs', () => {
    expect(
      mountSpec({ type: 'volume', source: 'v', target: '/opt/fiks/x', subpath: 'fiks/x', readonly: true }),
    ).toBe('type=volume,src=v,dst=/opt/fiks/x,volume-subpath=fiks/x,readonly');
  });

  test('egress denials are recognised in output', () => {
    expect(egressDenials('curl: (6) Could not resolve host: example.com')).toHaveLength(1);
    expect(egressDenials('Error: getaddrinfo EAI_AGAIN registry.npmjs.org\nok')).toHaveLength(1);
    expect(egressDenials('connect ENETUNREACH 1.1.1.1:443')).toHaveLength(1);
    expect(egressDenials('all tests passed')).toHaveLength(0);
  });
});

describe('image inputs', () => {
  test('lockfile importers', () => {
    const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      zod:
        specifier: 4.6.5

  packages/contracts: {}

  packages/proxy:
    dependencies: {}

packages:

  zod@4.6.5: {}
`;
    expect(lockImporters(lock)).toEqual(['.', 'packages/contracts', 'packages/proxy']);
    expect(lockImporters('lockfileVersion: 9.0\n')).toEqual(['.']);
  });

  test('manifest hash ignores insertion order and sees every byte', () => {
    const a = new Map([
      ['package.json', Buffer.from('{}')],
      ['pnpm-lock.yaml', Buffer.from('x')],
    ]);
    const b = new Map([
      ['pnpm-lock.yaml', Buffer.from('x')],
      ['package.json', Buffer.from('{}')],
    ]);
    expect(manifestHash(a)).toBe(manifestHash(b));
    b.set('pnpm-lock.yaml', Buffer.from('y'));
    expect(manifestHash(a)).not.toBe(manifestHash(b));
  });

  test('a tools archive with .env, .fiks or .work is refused', () => {
    expect(
      forbiddenEntries(['fiks/', 'fiks/.env.example', 'fiks/packages/cli/src/main.ts', 'fiks/README.md']),
    ).toEqual([]);
    expect(
      forbiddenEntries(['fiks/.env', 'fiks/.work/shop-mcp/x', 'fiks/.fiks/traces/a', 'fiks/a/.env']),
    ).toHaveLength(4);
  });
});

describe('actions agreement guards', () => {
  test('slug from remotes, branch names', () => {
    expect(slugFromRemote('https://github.com/vats98754/shop-mcp.git')).toBe('vats98754/shop-mcp');
    expect(slugFromRemote('git@github.com:vats98754/shop-mcp.git')).toBe('vats98754/shop-mcp');
    expect(branchFor('7bf2e665b3ed38110045fa3026cb14ea764e946d')).toBe('sbx-agree/7bf2e665b3ed');
  });

  test('only vats98754 base repos; forks of other owners are refused', () => {
    const own = { owner: { login: 'vats98754' }, isFork: false };
    expect(() => assertAllowedRepo('vats98754/shop-mcp', own)).not.toThrow();
    expect(() => assertAllowedRepo('someone/shop-mcp', own)).toThrow(/owner/);
    expect(() =>
      assertAllowedRepo('vats98754/servers', {
        ...own,
        isFork: true,
        parent: { owner: { login: 'modelcontextprotocol' } },
      }),
    ).toThrow(/fork/);
    expect(() =>
      assertAllowedRepo('vats98754/x', { ...own, isFork: true, parent: { owner: { login: 'vats98754' } } }),
    ).not.toThrow();
  });

  test('agreement rate counts only compared heads', () => {
    const rows = [
      { head: 'a', branch: 'b', local: 'green', actions: 'green', agree: true },
      { head: 'c', branch: 'd', local: 'red', actions: 'green', agree: false },
      { head: 'e', branch: 'f', local: 'red', actions: 'not-run', agree: null },
    ] as const;
    expect(summarizeAgreement([...rows])).toEqual({ compared: 2, agreed: 1, rate: 0.5 });
  });
});

describe('git push shim (host)', () => {
  const repo = join(tmp, 'repo');
  const remote = join(tmp, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'x',
  ]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', remote]);
  const shim = installGitShim(join(tmp, 'shim-bin'), join(tmp, 'logs', "it's push.jsonl"));
  const run = (args: string[]) =>
    spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { PATH: shim.path, HOME: tmp } });

  test('every form of push is recorded and blocked; the remote gets nothing', () => {
    for (const args of [
      ['push', 'origin', 'HEAD:refs/heads/main'],
      ['-C', repo, 'push', '--force', 'origin', 'HEAD'],
      ['-c', 'alias.p=push', 'p', 'origin', 'HEAD'],
      ['send-pack', remote, 'HEAD'],
    ]) {
      const r = run(args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/blocked in this run/);
    }
    const pushes = shim.pushes();
    expect(pushes).toHaveLength(4);
    expect(pushes[0]?.argv).toEqual(['push', 'origin', 'HEAD:refs/heads/main']);
    expect(pushes[0]?.cwd).toBe(execFileSync('pwd', { cwd: repo, encoding: 'utf8' }).trim());
    expect(execFileSync('git', ['--git-dir', remote, 'for-each-ref'], { encoding: 'utf8' })).toBe('');
  });

  test('other git commands go to the real git', () => {
    const r = run(['rev-parse', '--is-inside-work-tree']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('true');
    expect(realGit(shim.path)).not.toBe(join(shim.binDir, 'git'));
  });

  test('the log is JSON lines', () => {
    expect(parsePushLog(readFileSync(shim.logPath, 'utf8')).every((p) => typeof p.at === 'string')).toBe(
      true,
    );
  });
});

describe('machine-wide lock', () => {
  test('waits while another live process holds it, takes it once that holder is gone', async () => {
    process.env.FIKS_LOCK_DIR = join(tmp, 'locks');
    const holder = spawn('sleep', ['30']);
    try {
      mkdirSync(join(tmp, 'locks', 't'), { recursive: true });
      writeFileSync(join(tmp, 'locks', 't', 'pid'), String(holder.pid));
      let got = false;
      const p = withLock(
        't',
        async () => {
          got = true;
        },
        50,
      );
      await new Promise((r) => setTimeout(r, 400));
      expect(got).toBe(false);
      holder.kill('SIGKILL');
      await p;
      expect(got).toBe(true);
    } finally {
      holder.kill('SIGKILL');
      delete process.env.FIKS_LOCK_DIR;
    }
  });

  test('a hold by this process or an ancestor (with-lock docker …) is re-entered', async () => {
    process.env.FIKS_LOCK_DIR = join(tmp, 'locks');
    try {
      expect(ancestry()[0]).toBe(process.pid);
      mkdirSync(join(tmp, 'locks', 'mine'), { recursive: true });
      writeFileSync(join(tmp, 'locks', 'mine', 'pid'), String(ancestry().at(-1)));
      expect(await withLock('mine', async () => 'inside', 50)).toBe('inside');
    } finally {
      delete process.env.FIKS_LOCK_DIR;
    }
  });
});
