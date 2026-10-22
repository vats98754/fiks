// IV verdicts host vs container (WORKSTREAMS ARMS): for D1-D5, fiks-iv behind
// `fiks rerecord-head --check IV` on the base (seed-v1) and on the oracle head (seed-v1 +
// packages/cli/test/oracles/Di.patch). Base fails on the drift's target property, the oracle head
// passes, and the verdicts (pass/fail and failing property ids) are identical on the host and in
// the per-attempt container (repo sandbox image + the test-only fiks-tools image of HEAD).
// The traces are each drift's shop scenario on seed-v1 under vendor v2 with only that drift active
// (no injector rule), so the host needs no injector factory.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorktree } from '@fiks/repro';
import { beforeAll, describe, expect, test } from 'vitest';
import { runScenario } from '../../cli/src/commands/scenario.ts';
import { ArmChecks } from '../src/checks.ts';
import { loadDomains } from '../src/domains.ts';
import { DockerArmSandbox } from '../src/sandbox.ts';
import { loadFrozenTrace, traceProfile } from '../src/trace.ts';
import { createAttemptCheckout } from '../src/worktree.ts';
import { dockerReady, repoImage, scratch } from './support/container.ts';
import { ORACLES, ROOT, SHOP_DIR } from './support/fixtures.ts';
import { testToolsImage } from './support/tools-image.ts';

const ready = dockerReady();
const tmp = scratch();
const DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
const TARGET: Record<(typeof DRIFTS)[number], string> = {
  D1: 'shop.search_products/items.price.range',
  D2: 'shop.get_product/price.notNull',
  D3: 'shop.create_order/readAfterWrite',
  D4: 'shop.search_products/countMatchesTotal',
  D5: 'shop.get_order/created_at.freshness',
};

interface Verdict {
  pass: boolean;
  failing: string[];
}
const verdictOf = (code: number, out: string): Verdict => ({
  pass: code === 0 && /^IV PASS/m.test(out),
  failing: [...out.matchAll(/^IV FAIL (\S+):/gm)].map((m) => m[1] as string).sort(),
});

const traces: Record<string, string> = {};
let ck = '';
let base = '';
const heads: Record<string, string> = {};
const git = (...a: string[]) => execFileSync('git', a, { cwd: ck, encoding: 'utf8' }).trim();

beforeAll(async () => {
  if (!ready) return;
  await loadDomains();
  const seed = createWorktree(SHOP_DIR, 'seed-v1', { dir: join(tmp, 'seed') });
  try {
    for (const d of DRIFTS) {
      const out = await runScenario(d, {
        shopDir: seed.dir,
        traceDir: join(tmp, `traces-${d}`),
        eventsPath: join(tmp, 'events.jsonl'),
        clock: new Date('2026-10-18T12:00:00.000Z'),
        runId: `arms-iv-${d}`,
      });
      traces[d] = out.traces[0] as string;
    }
  } finally {
    seed.remove();
  }
  const c = createAttemptCheckout(SHOP_DIR, 'seed-v1', join(tmp, 'ck'));
  ck = c.dir;
  base = c.baseCommit;
  mkdirSync(join(ck, '.alerts'), { recursive: true });
  for (const d of DRIFTS) copyFileSync(traces[d] as string, join(ck, '.alerts', `${d}.json`));
  for (const d of DRIFTS) {
    git('checkout', '--quiet', '--detach', base);
    git('apply', join(ORACLES, `${d}.patch`));
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-am', `oracle ${d}`);
    heads[d] = git('rev-parse', 'HEAD');
  }
  git('checkout', '--quiet', '--detach', base);
  await testToolsImage();
}, 60 * 60_000);

describe.runIf(ready)('IV host vs container on D1-D5', () => {
  test(
    'bases fail on the target, oracle heads pass; host and container verdicts are identical',
    async () => {
      const profile = (d: string) => traceProfile(loadFrozenTrace(traces[d] as string).trace);
      const host: Record<string, Verdict> = {};
      for (const d of DRIFTS) {
        for (const [label, commit] of [
          ['base', base],
          ['fix', heads[d] as string],
        ] as const) {
          git('checkout', '--quiet', '--detach', commit);
          const r = spawnSync(
            join(ROOT, 'node_modules/.bin/tsx'),
            [
              join(ROOT, 'packages/cli/src/main.ts'),
              'rerecord-head',
              '--worktree',
              ck,
              '--profile',
              JSON.stringify(profile(d)),
              '--from',
              base,
              '--log',
              join(tmp, 'host-rerecord.jsonl'),
              '--check',
              'IV',
              '--recordings',
              `.alerts/${d}.json`,
              '--',
              join(ROOT, 'node_modules/.bin/tsx'),
              join(ROOT, 'packages/arms/src/iv-cli.ts'),
              '--trace',
              join(ck, `.alerts/${d}.json`),
              '--head',
              ck,
            ],
            {
              encoding: 'utf8',
              env: { ...process.env, FIKS_DIR: join(tmp, 'fiks-host') },
              maxBuffer: 64 * 1024 * 1024,
            },
          );
          host[`${d}/${label}`] = verdictOf(r.status ?? 1, r.stdout);
          execFileSync('git', ['clean', '-fdq', '--', 'test'], { cwd: ck }); // stale re-recordings
        }
      }
      git('checkout', '--quiet', '--detach', base);
      const sb = await DockerArmSandbox.create({
        worktree: ck,
        image: await repoImage('shop'),
        toolsImage: (await testToolsImage()).digest,
        toolsPurpose: 'test',
      });
      const container: Record<string, Verdict> = {};
      try {
        for (const d of DRIFTS) {
          const checks = new ArmChecks({
            sandbox: sb,
            domain: 'shop',
            profile: profile(d),
            fromCommit: base,
            alertRel: `.alerts/${d}.json`,
            alertVisible: true,
            rerecordLog: join(tmp, 'container-rerecord.jsonl'),
          });
          for (const [label, commit] of [
            ['base', base],
            ['fix', heads[d] as string],
          ] as const) {
            git('checkout', '--quiet', '--detach', commit);
            const r = await checks.iv();
            container[`${d}/${label}`] = verdictOf(r.code, r.output);
          }
        }
      } finally {
        await sb.cleanup();
      }
      console.log(`[iv host]      ${JSON.stringify(host)}\n[iv container] ${JSON.stringify(container)}`);
      for (const d of DRIFTS) {
        expect(host[`${d}/base`]?.pass, d).toBe(false);
        expect(host[`${d}/base`]?.failing, d).toContain(TARGET[d]);
        expect(host[`${d}/fix`], d).toEqual({ pass: true, failing: [] });
      }
      expect(container).toEqual(host);
      expect(
        readFileSync(join(tmp, 'container-rerecord.jsonl'), 'utf8').split('\n').filter(Boolean),
      ).toHaveLength(10);
    },
    60 * 60_000,
  );
});
