// The tracker Domain (PLAN P8, Appendix `Domain`). Registered by
// packages/cli/src/bootstrap/10-tracker.ts, so `--domain tracker` resolves to it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog, Domain, InjectorRule, UpstreamMiddleware } from '@fiks/interfaces';
import {
  CATALOG,
  type CatalogIssue,
  DEFAULT_EXTENDED_CATALOG,
  extendedCatalogPath,
  loadExtended,
} from './catalog.ts';
import { trackerEntityClass } from './entityClass.ts';
import { trackerEnumerate } from './enumerate.ts';
import { TRACKER_ALLOWED_EDIT_PATHS, trackerReproEmitter, trackerSuite } from './hooks.ts';
import { trackerOriginEntity } from './originEntity.ts';
import { FIXTURE_CALLS, SCENARIOS } from './scenarios.ts';
import { createVendor, VERSION_HEADER } from './server.ts';
import { TASKS } from './tasks.ts';
import { trackerTruth } from './truth.ts';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * The tracker's frozen evaluation clock (PLAN 3.1 "Clock"): every record run uses it for the
 * vendor clock and the proxy's `now`. A constant, committed before F2 and recorded in the F2
 * ledger. Every catalogued timestamp lies before it.
 */
export const TRACKER_FROZEN_CLOCK = '2026-10-01T12:00:00.000Z';

/** The base every tracker drift is applied to (cut from tracker-mcp main at A0 by ORCH seed-tag). */
export const TRACKER_SEED_TAG = 'seed-tracker-v1';

/** Where the A0 contract author's tracker contracts are written (BLIND `author --protocol tracker`). */
export const TRACKER_CONTRACTS_PATH = join(ROOT, 'packages/contracts/contracts/tracker-mcp.contracts.json');

/** v1 paginates the search endpoint: `GET /issues?page=` with `next_page`. */
export const TRACKER_PAGINATED_ENDPOINTS: Domain['paginatedEndpoints'] = [
  { method: 'GET', pathPattern: '^/issues$', pageParam: 'page' },
];

/** The local tracker-mcp clone: FIKS_TRACKER_DIR, else `.work/tracker-mcp` (scripts/ensure-tracker-mcp.mjs). */
export const trackerRepoDir = () => process.env.FIKS_TRACKER_DIR ?? join(ROOT, '.work', 'tracker-mcp');

// --- Injector (P7): the factory ORCH registers at startup (bootstrap/30-injector.ts, through
// CORE's registerInjectorFactory), read from the same process-wide slot. -----------------------

type InjectorFactory = (opts: {
  target: string;
  rule: InjectorRule;
}) => Promise<{ url: string; close(): Promise<void> }>;
const INJECTOR_KEY = Symbol.for('fiks.injector.factory');

export function trackerInjectorHook(rule: InjectorRule): UpstreamMiddleware {
  return {
    name: `injector:${rule.id}`,
    start: (target) => {
      const factory = (globalThis as { [INJECTOR_KEY]?: InjectorFactory })[INJECTOR_KEY];
      if (!factory) {
        throw new Error(
          `injector rule ${rule.id}: no injector factory is registered (packages/cli/src/bootstrap/30-injector.ts)`,
        );
      }
      return factory({ target, rule });
    },
  };
}

// --- Issue index for entity classes (original + extended keys are disjoint) ---------------

let extendedIndex: { file: string; byKey: Map<string, CatalogIssue> } | undefined;

function extendedByKey(): Map<string, CatalogIssue> {
  const file = extendedCatalogPath();
  if (extendedIndex?.file !== file) {
    let byKey = new Map<string, CatalogIssue>();
    if (existsSync(file)) byKey = new Map(loadExtended(file).map((i) => [i.key, i]));
    extendedIndex = { file, byKey };
  }
  return extendedIndex.byKey;
}

export const trackerIssueIndex = (key: string): CatalogIssue | undefined =>
  CATALOG.find((i) => i.key === key) ?? extendedByKey().get(key);

export const trackerDomain: Domain = {
  id: 'tracker',
  createVendor: (catalog: Catalog, opts) => {
    const version = opts?.version ?? 'v1';
    if (version !== 'v1') {
      throw new Error(
        `tracker vendor has only v1 (drifts come from an injector rule), got ${JSON.stringify(version)}`,
      );
    }
    if (opts?.drifts?.trim()) {
      throw new Error(`tracker vendor has no built-in drifts (got ${opts.drifts}); use an injector rule`);
    }
    return createVendor({ version: 'v1', catalog, now: opts?.now });
  },
  frozenClock: TRACKER_FROZEN_CLOCK,
  truth: trackerTruth,
  entityClass: (call) => trackerEntityClass(call, trackerIssueIndex),
  originEntity: trackerOriginEntity,
  injectorHook: trackerInjectorHook,
  versionHeader: VERSION_HEADER,
  contractsPath: TRACKER_CONTRACTS_PATH,
  baseUrlEnv: 'TRACKER_BASE_URL',
  serverCommand: (dir) => ({ command: join(dir, 'node_modules/.bin/tsx'), args: ['src/main.ts'], cwd: dir }),
  repo: { slug: process.env.TRACKER_MCP_REPO ?? 'vats98754/tracker-mcp', dir: trackerRepoDir },
  seedTag: TRACKER_SEED_TAG,
  scenarios: SCENARIOS,
  fixtureCalls: FIXTURE_CALLS,
  tasks: TASKS,
  promptHints: {
    repair: [
      'src/tools/*.ts: one file per tool. src/vendor.ts: the HTTP client.',
      "vendor/openapi.json: the vendor's published spec.",
      'test/fixtures/v1/*.json: recordings against the base vendor version, which must keep producing the same output.',
      'Responses carry a tracker-api-version response header.',
      'Checks: pnpm typecheck, pnpm lint, pnpm test.',
    ],
    server: 'tracker-mcp',
    extendedCatalog: DEFAULT_EXTENDED_CATALOG,
  },
  enumerate: trackerEnumerate,
  paginatedEndpoints: TRACKER_PAGINATED_ENDPOINTS,
  reproEmitter: trackerReproEmitter,
  suite: trackerSuite,
  allowedEditPaths: TRACKER_ALLOWED_EDIT_PATHS,
};
