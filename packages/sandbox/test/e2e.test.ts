// Slow end-to-end checks (several minutes; set FIKS_SANDBOX_E2E=1):
//  - ciLocal on shop-mcp 7bf2e66 is green, and on the D1–D5 oracle patches applied to seed-v1 its
//    verdicts equal the host's `pnpm test` verdicts;
//  - execFiks: the fiks CLI from a read-only fiks-tools mount runs `scenario v1-all` in a
//    --network none container on a seed-v1 worktree with Linux node_modules, with the same verdicts
//    as the host run. FIKS_TOOLS_IMAGE picks the tools image; otherwise a test-only image is built
//    from this checkout's HEAD with --apply-fragments.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DockerExecBackend } from '../src/backend.ts';
import { buildRepoImage } from '../src/build.ts';
import { buildToolsImage, FIKS_ROOT } from '../src/build-tools.ts';
import { ciLocal } from '../src/ci-local.ts';
import { assertDocker, docker } from '../src/docker.ts';
import { execFiks, FIKS_SANDBOX_ENV, toolsMounts } from '../src/tools.ts';
import { SHOP, shopWorktree } from './support.ts';

const E2E = process.env.FIKS_SANDBOX_E2E === '1';
const ORACLES = join(FIKS_ROOT, 'packages/cli/test/oracles');
const tmp = mkdtempSync(join(tmpdir(), 'fiks-sbx-e2e-'));
/** Host runs get only what they need: no tokens. */
const hostEnv = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? homedir(),
  CI: '1',
  ...extra,
});
let image = '';
/** FIKS_SANDBOX_EVIDENCE=<file>: one line per observation, for the build log. */
const evidence = (line: string) => {
  console.log(line);
  if (process.env.FIKS_SANDBOX_EVIDENCE) appendFileSync(process.env.FIKS_SANDBOX_EVIDENCE, `${line}\n`);
};

beforeAll(async () => {
  if (!E2E) return;
  assertDocker();
  image = (await buildRepoImage({ repo: SHOP })).digest;
}, 20 * 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.runIf(E2E)('ciLocal agrees with the host', () => {
  test(
    'shop-mcp 7bf2e66: ciLocal is green',
    async () => {
      const wt = shopWorktree('7bf2e66');
      try {
        const r = await ciLocal(wt.dir, image);
        expect(r.green, r.log).toBe(true);
        evidence(
          `[e2e] 7bf2e66 ciLocal green=${r.green} steps=${r.steps.map((s) => `${s.run || s.name}:${s.status}`).join(', ')}`,
        );
      } finally {
        wt.remove();
      }
    },
    15 * 60_000,
  );

  for (const drift of ['D1', 'D2', 'D3', 'D4', 'D5']) {
    test(
      `oracle ${drift} on seed-v1: ciLocal verdict = host 'pnpm test' verdict`,
      async () => {
        const wt = shopWorktree('seed-v1');
        try {
          execFileSync('git', ['apply', join(ORACLES, `${drift}.patch`)], { cwd: wt.dir });
          const host = spawnSync('pnpm', ['test'], { cwd: wt.dir, env: hostEnv(), encoding: 'utf8' });
          const hostGreen = host.status === 0;
          const r = await ciLocal(wt.dir, image);
          const testStep = r.steps.find((s) => s.run === 'pnpm test');
          evidence(
            `[e2e] ${drift}: host pnpm test exit=${host.status} (${hostGreen ? 'green' : 'red'}); ciLocal green=${r.green}; ` +
              r.steps
                .filter((s) => s.kind === 'ci')
                .map((s) => `${s.run}:${s.status}`)
                .join(', '),
          );
          expect(r.green, `${r.log}\n--- host ---\n${host.stdout.slice(-3000)}`).toBe(hostGreen);
          expect(testStep?.status === 'pass').toBe(hostGreen);
        } finally {
          wt.remove();
        }
      },
      15 * 60_000,
    );
  }
});

describe.runIf(E2E)('execFiks from the fiks-tools mount', () => {
  test(
    'scenario v1-all: same verdicts as the host (all verified); no .env, exact env, Linux esbuild',
    async () => {
      const tools =
        process.env.FIKS_TOOLS_IMAGE ?? (await buildToolsImage({ ref: 'HEAD', applyFragments: true })).digest;
      const seed = shopWorktree('seed-v1');
      const fiksDir = join(tmp, 'fiks');
      try {
        // Host run on the same worktree (its macOS node_modules), with scratch output in $TMPDIR.
        const host = spawnSync('pnpm', ['--silent', 'fiks', 'scenario', 'v1-all', '--json'], {
          cwd: FIKS_ROOT,
          env: hostEnv({ FIKS_DIR: fiksDir, FIKS_SEED_DIR: seed.dir }),
          encoding: 'utf8',
        });
        expect(host.status, host.stderr).toBe(0);
        const hostRun = JSON.parse(host.stdout) as ScenarioOut;

        // The CLI resolves seed-v1 to <ROOT>/.work/wt/ref-seed-v1, so the worktree is mounted there.
        const sb = new DockerExecBackend({
          worktree: seed.dir,
          image,
          workdir: '/opt/fiks/.work/wt/ref-seed-v1',
          mounts: await toolsMounts(tools, { purpose: 'test' }),
        });
        try {
          const r = await execFiks(sb, ['scenario', 'v1-all', '--json'], { timeoutMs: 5 * 60_000 });
          expect(r.code, r.stderr).toBe(0);
          const sbRun = JSON.parse(r.stdout) as ScenarioOut;
          const verdicts = (s: ScenarioOut) =>
            s.calls.map((c) => `${c.tool} ${JSON.stringify(c.args)} -> ${c.receipt?.verdict}`);
          evidence(`[e2e] host:    ${verdicts(hostRun).join(' | ')}`);
          evidence(`[e2e] sandbox: ${verdicts(sbRun).join(' | ')}`);
          expect(verdicts(sbRun)).toEqual(verdicts(hostRun));
          expect(sbRun.calls.length).toBeGreaterThan(0);
          // The host run's own verdicts: every call verified except get_product p-0000 (a missing
          // product, unverifiable by contract design); none violated.
          expect(sbRun.calls.some((c) => c.receipt?.verdict === 'violated')).toBe(false);

          const net = await docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', sb.name]);
          expect(net.stdout.trim()).toBe('none');
          const inFiksEnv = { env: { ...FIKS_SANDBOX_ENV }, containerCwd: '/tmp' };
          expect((await sb.exec('test', ['-e', '/opt/fiks/.env'], inFiksEnv)).code).toBe(1);
          expect((await sb.exec('test', ['-e', '/opt/fiks/.fiks'], inFiksEnv)).code).toBe(1);
          const env = await sb.exec('env', [], inFiksEnv);
          expect(env.stdout.trim().split('\n').sort()).toEqual(
            Object.entries(FIKS_SANDBOX_ENV)
              .map(([k, v]) => `${k}=${v}`)
              .sort(),
          );
          const write = await sb.exec('sh', ['-c', 'echo x > /opt/fiks/packages/x'], inFiksEnv);
          expect(write.code).not.toBe(0);
          const esb = await sb.exec(
            'node',
            [
              '-e',
              "const e=require('esbuild');const p=require('path');" +
                "const nat=require.resolve('@esbuild/linux-'+process.arch+'/package.json',{paths:[p.dirname(require.resolve('esbuild'))]});" +
                "console.log(process.platform,e.version,nat,JSON.stringify(e.transformSync('let a: number = 1',{loader:'ts'}).code))",
            ],
            { ...inFiksEnv, containerCwd: '/opt/fiks/node_modules/tsx' },
          );
          evidence(`[e2e] esbuild: ${esb.stdout.trim()}`);
          expect(esb.code, esb.stderr).toBe(0);
          expect(esb.stdout).toMatch(/^linux \S+ \/opt\/fiks\/node_modules\/\.pnpm\/.*@esbuild\/linux-/);
          expect(esb.stdout).toContain('let a = 1;');
        } finally {
          await sb.cleanup();
        }
      } finally {
        seed.remove();
      }
    },
    40 * 60_000,
  );
});

interface ScenarioOut {
  calls: { tool: string; args: unknown; receipt?: { verdict: string } }[];
}
