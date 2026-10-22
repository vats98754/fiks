#!/usr/bin/env node
// Builds the TRK-DEV-1 dev DriftPackage files that are generated (PLAN 5.1 "Build-phase dev
// drift"): the rule hash in TRK-DEV-1/rule.json, the hidden tests (TRK-DEV-1/hidden/*.test.ts),
// their renamed-id variant (TRK-DEV-1/hidden-renamed/*.test.ts) and the manifest TRK-DEV-1.json.
// Upstream responses come from tracker vendor v1 behind the rule (frozen clock); expected outputs
// come from v1 ground truth (truth()). The transform, ref A, ref B and the generator module are
// hand-written. Deterministic: a rerun rewrites identical bytes (checked by test/driftpkg.test.ts).
// usage: tsx packages/vendor-tracker/src/build-trk-dev-1.ts [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DriftPackage, InjectorRule } from '@fiks/interfaces';
import {
  type HiddenCase,
  type HiddenExchange,
  type HiddenStep,
  type LoadedRule,
  renamedCase,
  renderHiddenTest,
  ruleHash,
  startRuleProxy,
} from './devdrift.ts';
import { TRACKER_FROZEN_CLOCK } from './domain.ts';
import { createVendor } from './server.ts';
import { trackerTruth } from './truth.ts';

export const DRIFTPKG_DIR = new URL('../fixtures/driftpkgs/', import.meta.url).pathname;
export const TRK_DEV_1 = 'TRK-DEV-1';

/** The rule, without its hash (the hash is computed over this and the transform's bytes). */
export const RULE: Omit<InjectorRule, 'hash'> = {
  id: TRK_DEV_1,
  domain: 'tracker',
  match: { method: 'GET', pathPattern: '^/issues/[^/]+/comments$' },
  transform: 'transform.ts',
  clockFrozen: true,
};

interface CaseSpec {
  slug: string;
  title: string;
  manifestation: string;
  upstream: 'drifted' | 'v1';
  steps: {
    tool: string;
    args: Record<string, unknown>;
    requests: { method: string; path: string; body?: unknown }[];
  }[];
}

const listComments = (key: string) => ({
  tool: 'list_comments',
  args: { issue_key: key },
  requests: [{ method: 'GET', path: `/issues/${key}/comments` }],
});

export const CASES: CaseSpec[] = [
  {
    slug: 'comments-other-issue',
    title: 'list_comments returns every comment of an issue with several comments',
    manifestation: 'other input to the drifted tool (an issue that is not the frozen trace call)',
    upstream: 'drifted',
    steps: [listComments('TRK-115')],
  },
  {
    slug: 'comments-single',
    title: 'list_comments returns the only comment of an issue',
    manifestation: 'other input to the drifted tool (a one-comment issue)',
    upstream: 'drifted',
    steps: [listComments('TRK-105')],
  },
  {
    slug: 'comments-none',
    title: 'list_comments on an issue without comments is empty and consistent',
    manifestation: 'boundary input to the drifted tool (no comments)',
    upstream: 'drifted',
    steps: [listComments('TRK-103')],
  },
  {
    slug: 'comment-roundtrip',
    title: 'a comment added with add_comment is listed by list_comments',
    manifestation: 'another tool flow consuming the drifted field (write, then read back)',
    upstream: 'drifted',
    steps: [
      {
        tool: 'add_comment',
        args: { issue_key: 'TRK-114', body: 'Repro steps attached; happens for every viewer outside UTC.' },
        requests: [
          {
            method: 'POST',
            path: '/issues/TRK-114/comments',
            body: { body: 'Repro steps attached; happens for every viewer outside UTC.' },
          },
        ],
      },
      listComments('TRK-114'),
    ],
  },
  {
    slug: 'comments-v1-preserved',
    title: 'list_comments still reads the v1 response format',
    manifestation: 'v1 behaviour preserved (vendor v1 without the drift)',
    upstream: 'v1',
    steps: [listComments('TRK-104')],
  },
];

/** Runs one case on a fresh v1 vendor (expected outputs) and on vendor v1 (+ the rule) (responses). */
async function buildCase(spec: CaseSpec, rule: LoadedRule): Promise<HiddenCase> {
  const now = () => new Date(TRACKER_FROZEN_CLOCK);
  const truthVendor = createVendor({ now });
  const servedVendor = createVendor({ now });
  const servedUrl = await servedVendor.listen();
  const proxy =
    spec.upstream === 'drifted' ? await startRuleProxy(servedUrl, rule, TRACKER_FROZEN_CLOCK) : null;
  const truthUrl = await truthVendor.listen();
  const base = proxy?.url ?? servedUrl;
  const exchanges: HiddenExchange[] = [];
  const steps: HiddenStep[] = [];
  try {
    for (const step of spec.steps) {
      for (const r of step.requests) {
        const init: RequestInit = {
          method: r.method,
          ...(r.body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) }),
        };
        const res = await fetch(`${base}${r.path}`, init);
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          if (k === 'content-type' || k === 'tracker-api-version') headers[k] = v;
        });
        exchanges.push({
          method: r.method,
          path: r.path,
          status: res.status,
          headers,
          body: await res.text(),
        });
        await (await fetch(`${truthUrl}${r.path}`, init)).text();
      }
      const t = trackerTruth({ tool: step.tool, args: step.args }, truthVendor.state);
      if (!t.inputValid) throw new Error(`${spec.slug}: ${step.tool} input is invalid on v1`);
      steps.push({ tool: step.tool, args: step.args, expected: t.expected });
    }
  } finally {
    await proxy?.close();
    await servedVendor.close();
    await truthVendor.close();
  }
  return {
    slug: spec.slug,
    title: spec.title,
    manifestation: spec.manifestation,
    upstream: spec.upstream,
    exchanges,
    steps,
  };
}

export interface BuiltFile {
  path: string;
  text: string;
}

/** Every generated file of TRK-DEV-1 (paths relative to fixtures/driftpkgs/). */
export async function buildTrkDev1(dir = DRIFTPKG_DIR): Promise<BuiltFile[]> {
  const pkgDir = join(dir, TRK_DEV_1);
  const hash = ruleHash(RULE, join(pkgDir, RULE.transform));
  const rule: InjectorRule = { ...RULE, hash };
  const files: BuiltFile[] = [{ path: `${TRK_DEV_1}/rule.json`, text: `${JSON.stringify(rule, null, 2)}\n` }];
  const loaded: LoadedRule = {
    ...rule,
    file: join(pkgDir, 'rule.json'),
    transformPath: join(pkgDir, RULE.transform),
  };
  const hidden: string[] = [];
  for (const spec of CASES) {
    const c = await buildCase(spec, loaded);
    files.push({
      path: `${TRK_DEV_1}/hidden/${c.slug}.test.ts`,
      text: renderHiddenTest(TRK_DEV_1, c, 'hidden'),
    });
    files.push({
      path: `${TRK_DEV_1}/hidden-renamed/${c.slug}.test.ts`,
      text: renderHiddenTest(TRK_DEV_1, renamedCase(c), 'renamed-id'),
    });
    hidden.push(`${TRK_DEV_1}/hidden/${c.slug}.test.ts`);
  }
  const manifest: DriftPackage = {
    id: TRK_DEV_1,
    domain: 'tracker',
    base: 'dev-tracker-stub',
    stratum: 'dev',
    ideationFamily: 'builder',
    authorSession: 'DOM2 builder (dev only; never confirmatory)',
    injectorRule: { path: `${TRK_DEV_1}/rule.json`, hash },
    hiddenTests: hidden,
    refA: `${TRK_DEV_1}/refA.patch`,
    refB: `${TRK_DEV_1}/refB.patch`,
    renamedIdVariant: `${TRK_DEV_1}/hidden-renamed`,
    generators: [`${TRK_DEV_1}/generators.ts`],
    changelog:
      'API 2026-10-01: the comment list of GET /issues/{key}/comments is returned under `comments` (previously `items`).',
  };
  files.push({ path: `${TRK_DEV_1}.json`, text: `${JSON.stringify(manifest, null, 2)}\n` });
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const files = await buildTrkDev1();
  const stale: string[] = [];
  for (const f of files) {
    const target = join(DRIFTPKG_DIR, f.path);
    let have: string | null = null;
    try {
      have = readFileSync(target, 'utf8');
    } catch {}
    if (have === f.text) continue;
    if (check) stale.push(f.path);
    else {
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, f.text);
      console.log(`[build-trk-dev-1] wrote ${f.path}`);
    }
  }
  if (check && stale.length) {
    console.error(`[build-trk-dev-1] stale: ${stale.join(', ')}`);
    process.exit(1);
  }
}
