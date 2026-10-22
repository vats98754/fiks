// Docker tests (Docker Desktop must be running; nothing here is skipped when it is not). One
// per-attempt container on a shop-mcp worktree: canary probes, offline install, the git shim, and
// ciLocal/runPreGate with a failing extra check.
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DockerExecBackend, SANDBOX_ENV } from '../src/backend.ts';
import { buildRepoImage } from '../src/build.ts';
import { ciLocal, runPreGate } from '../src/ci-local.ts';
import { assertDocker, docker } from '../src/docker.ts';
import { makeCanaries, runCanaryProbes } from '../src/probes.ts';
import { SHOP, shopWorktree, type TestWorktree } from './support.ts';

const tmp = mkdtempSync(join(tmpdir(), 'fiks-sbx-ct-'));
const egressLog = join(tmp, 'egress.jsonl');
const canaries = makeCanaries();
let image = '';
let wt: TestWorktree;
let sb: DockerExecBackend;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  assertDocker();
  image = (await buildRepoImage({ repo: SHOP })).digest;
  // Plant the canaries in this (host) process's environment: they must not reach the container.
  for (const [k, v] of Object.entries(canaries)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  wt = shopWorktree('HEAD');
  sb = new DockerExecBackend({ worktree: wt.dir, image, egressLog });
  await sb.start();
}, 20 * 60_000);

afterAll(async () => {
  await sb?.cleanup();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  wt?.remove();
  rmSync(tmp, { recursive: true, force: true });
}, 120_000);

describe('per-attempt container', () => {
  test("'curl https://example.com' fails on the network (curl is installed)", async () => {
    const r = await sb.exec('curl', ['-sS', '--max-time', '5', 'https://example.com']);
    expect(r.code).not.toBe(0);
    expect(r.code).not.toBe(127);
    expect(r.stderr).toMatch(/Could not resolve host|Failed to connect|Network is unreachable/);
    // The backend logged the denied egress.
    const log = readFileSync(egressLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(log.some((e) => e.container === sb.name && e.argv[0] === 'curl' && e.denied === true)).toBe(true);
  });

  test("'env' shows exactly PATH, CI, HOME and no FIKS_CANARY/GH_TOKEN", async () => {
    expect(process.env.GH_TOKEN).toBe(canaries.GH_TOKEN);
    const r = await sb.exec('env', []);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n').sort();
    expect(lines).toEqual(
      Object.entries(SANDBOX_ENV)
        .map(([k, v]) => `${k}=${v}`)
        .sort(),
    );
    expect(r.stdout).not.toMatch(/FIKS_CANARY|GH_TOKEN|fiks-canary-/);
  });

  test('a write outside the mounted worktree fails; inside it works', async () => {
    for (const p of ['/opt/x', '/etc/x', '/usr/local/bin/x', '/x']) {
      const r = await sb.exec('sh', ['-c', `echo x > ${p}`]);
      expect(r.code, p).not.toBe(0);
      expect(r.stderr).toMatch(/Read-only file system/);
    }
    const r = await sb.exec('sh', ['-c', 'echo x > .sbx-probe && cat .sbx-probe && rm .sbx-probe']);
    expect(r.code).toBe(0);
  });

  test("the worktree's node_modules is the image's Linux install, not the host symlink", async () => {
    expect(existsSync(join(wt.dir, 'node_modules'))).toBe(true);
    const r = await sb.exec('sh', [
      '-c',
      'test ! -L node_modules && test -d node_modules/.pnpm && ls node_modules/.pnpm | grep -c "@esbuild+linux" && ! ls node_modules/.pnpm | grep -q "@esbuild+darwin"',
    ]);
    expect(r.code, r.stderr).toBe(0);
  });

  test(
    "'pnpm install --offline' succeeds with --network none (node_modules emptied first)",
    async () => {
      const wipe = await sb.exec('sh', [
        '-c',
        'find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} + && ls -A node_modules | wc -l',
      ]);
      expect(wipe.stdout.trim()).toBe('0');
      const r = await sb.exec('pnpm', ['install', '--offline', '--frozen-lockfile'], {
        timeoutMs: 5 * 60_000,
      });
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      const bin = await sb.exec('sh', ['-c', 'ls node_modules/.bin']);
      expect(bin.stdout).toMatch(/vitest/);
    },
    6 * 60_000,
  );

  test('the canary probe suite passes', async () => {
    const p = await runCanaryProbes(sb, { canaries: Object.values(canaries), egressLog });
    const failed = p.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(p.results.length).toBeGreaterThanOrEqual(14);
  }, 120_000);

  test("a 'git push' in the container is recorded and blocked", async () => {
    const r = await sb.exec('git', [
      'push',
      'https://github.com/vats98754/shop-mcp.git',
      'HEAD:refs/heads/x',
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/blocked in this run/);
    const pushes = await sb.pushAttempts();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.argv).toEqual([
      'push',
      'https://github.com/vats98754/shop-mcp.git',
      'HEAD:refs/heads/x',
    ]);
    const other = await sb.exec('git', ['--version']);
    expect(other.code).toBe(0);
  });
});

describe('ciLocal / runPreGate in the sandbox', () => {
  const extra = 'echo "IV: shop.get_product/price.notNull violated (extra check output)"; exit 1';

  test(
    'ciLocal: CI steps green, an extra check that exits 1 makes it red with its output in the log',
    async () => {
      const r = await ciLocal(wt.dir, image, [extra], { backend: sb });
      const ci = r.steps.filter((s) => s.kind === 'ci');
      expect(
        ci.map((s) => [s.run, s.status]),
        r.log,
      ).toEqual([
        ['pnpm install --frozen-lockfile --offline', 'pass'],
        ['pnpm typecheck', 'pass'],
        ['pnpm lint', 'pass'],
        ['pnpm test', 'pass'],
      ]);
      expect(r.green).toBe(false);
      expect(r.log).toContain('IV: shop.get_product/price.notNull violated (extra check output)');
      expect(r.steps.at(-1)).toMatchObject({ kind: 'extra', status: 'fail', code: 1 });
    },
    10 * 60_000,
  );

  test('runPreGate with the same check is red with its output in the log', async () => {
    const r = await runPreGate(wt.dir, image, [extra], { backend: sb });
    expect(r.green).toBe(false);
    expect(r.steps).toHaveLength(1);
    expect(r.log).toContain('IV: shop.get_product/price.notNull violated (extra check output)');
  });

  test('runPreGate with a passing check is green', async () => {
    const r = await runPreGate(wt.dir, image, ['test -f package.json'], { backend: sb });
    expect(r.green).toBe(true);
  });

  test("a failing command piped into tee is red (GitHub's -eo pipefail run shell)", async () => {
    const r = await runPreGate(wt.dir, image, ['false | tee /tmp/fiks-pipefail.txt'], { backend: sb });
    expect(r.green, r.log).toBe(false);
    expect(r.steps[0]?.code).toBe(1);
  });
});

describe('cleanup', () => {
  test(
    'removes the container and its volume and puts the host node_modules symlink back',
    async () => {
      const w = shopWorktree('HEAD');
      try {
        const target = readlinkSync(join(w.dir, 'node_modules'));
        const b = new DockerExecBackend({ worktree: w.dir, image });
        await b.start();
        expect(existsSync(join(w.dir, 'node_modules'))).toBe(true);
        expect(lstatSync(join(w.dir, 'node_modules')).isSymbolicLink()).toBe(false);
        await b.cleanup();
        expect(lstatSync(join(w.dir, 'node_modules')).isSymbolicLink()).toBe(true);
        expect(readlinkSync(join(w.dir, 'node_modules'))).toBe(target);
        expect((await docker(['container', 'inspect', b.name])).code).not.toBe(0);
        expect((await docker(['volume', 'inspect', `${b.name}-nm`])).code).not.toBe(0);
      } finally {
        w.remove();
      }
    },
    5 * 60_000,
  );
});
