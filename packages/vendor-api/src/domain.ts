// The shop Domain (PLAN P8, Appendix `Domain`). Registered by packages/cli/src/bootstrap/00-shop.ts,
// which supplies the members that live in other packages (repro hooks, bench tasks) as plain
// parameters, so this package imports none of them.
import { join } from 'node:path';
import type {
  Catalog,
  Domain,
  DomainSuite,
  DomainTask,
  InjectorRule,
  ReproEmitter,
  UpstreamMiddleware,
} from '@fiks/interfaces';
import {
  CATALOG,
  type CatalogProduct,
  DEFAULT_EXTENDED_CATALOG,
  extendedCatalogPath,
  loadExtended,
} from './catalog.ts';
import { VERSION_HEADER, type VendorVersion } from './drifts.ts';
import { shopEnumerate } from './enumerate.ts';
import { shopEntityClass, shopOriginEntity } from './originEntity.ts';
import { FIXTURE_CALLS, SCENARIOS } from './scenarios.ts';
import { createVendor } from './server.ts';
import { shopTruth } from './truth.ts';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * The shop's frozen evaluation clock (PLAN 3.1 "Clock"): every record run uses it for the vendor
 * clock and the proxy's `now`. A constant, committed before F2 and recorded in the F2 ledger.
 */
export const SHOP_FROZEN_CLOCK = '2026-10-01T12:00:00.000Z';

/** Repair edit allow-list (= ec241bc's REPAIR_ALLOWED in packages/repair/src/guard.ts). */
export const SHOP_ALLOWED_EDIT_PATHS: readonly string[] = ['^src/.+\\.ts$'];

/**
 * v1 paginates no endpoint (GET /products returns every match on one page, `next_cursor: null`),
 * so the list is empty; the spec's optional `cursor` is not pagination in the base version.
 */
export const SHOP_PAGINATED_ENDPOINTS: Domain['paginatedEndpoints'] = [];

// --- Injector factory (P7) ----------------------------------------------------------------
// The injector (packages/injector, INJ) is registered at startup by ORCH's bootstrap
// (`registerInjectorFactory` from packages/cli/src/harness.ts). The shop Domain only wraps it.

export type InjectorFactory = (opts: {
  target: string;
  rule: InjectorRule;
}) => Promise<{ url: string; close(): Promise<void> }>;

const INJECTOR_KEY = Symbol.for('fiks.injector.factory');
const holder = globalThis as { [INJECTOR_KEY]?: InjectorFactory };

export function registerInjectorFactory(factory: InjectorFactory): void {
  const existing = holder[INJECTOR_KEY];
  if (existing && existing !== factory)
    throw new Error('registerInjectorFactory: a factory is already registered');
  holder[INJECTOR_KEY] = factory;
}

export function getInjectorFactory(): InjectorFactory | undefined {
  return holder[INJECTOR_KEY];
}

/** For tests: removes the registered factory. */
export function clearInjectorFactory(): void {
  delete holder[INJECTOR_KEY];
}

/** The upstream middleware that applies `rule` in front of the vendor. */
export function injectorMiddleware(rule: InjectorRule): UpstreamMiddleware {
  return {
    name: `injector:${rule.id}`,
    start: (target) => {
      const factory = getInjectorFactory();
      if (!factory) {
        throw new Error(
          `injector rule ${rule.id}: no injector factory is registered (packages/cli/src/bootstrap/30-injector.ts)`,
        );
      }
      return factory({ target, rule });
    },
  };
}

// --- Product index for entity classes (original + extended ids are disjoint) ---------------

let extendedIndex: { file: string; byId: Map<string, CatalogProduct> } | undefined;

/** Extended entities by id (empty until the A0 catalog exists), reloaded when the file changes. */
function extendedById(): Map<string, CatalogProduct> {
  const file = extendedCatalogPath();
  if (extendedIndex?.file !== file) {
    let byId = new Map<string, CatalogProduct>();
    try {
      byId = new Map(loadExtended(file).map((p) => [p.id, p]));
    } catch {
      // No extended catalog yet (it is authored at A0): extended ids are then unknown.
    }
    extendedIndex = { file, byId };
  }
  return extendedIndex.byId;
}

const productIndex = (id: string): CatalogProduct | undefined =>
  CATALOG.find((p) => p.id === id) ?? extendedById().get(id);

function categories(): Set<string> {
  return new Set([...CATALOG, ...extendedById().values()].map((p) => p.category));
}

export interface ShopDomainParts {
  /** Repro files in shop-mcp's layout (packages/repro `shopReproEmitter`). */
  reproEmitter: ReproEmitter;
  /** shop-mcp's whole vitest suite (packages/repro `shopSuite`). */
  suite: DomainSuite;
  /** Bench tasks (packages/bench `TASKS`). */
  tasks?: DomainTask[];
}

const versionOf = (v: string): VendorVersion => {
  if (v !== 'v1' && v !== 'v2')
    throw new Error(`shop vendor version must be v1 or v2, got ${JSON.stringify(v)}`);
  return v;
};

export function createShopDomain(parts: ShopDomainParts): Domain {
  return {
    id: 'shop',
    createVendor: (catalog: Catalog, opts) =>
      createVendor({
        version: versionOf(opts?.version ?? 'v1'),
        drifts: opts?.drifts,
        now: opts?.now,
        catalog,
      }),
    frozenClock: SHOP_FROZEN_CLOCK,
    truth: shopTruth,
    entityClass: (call) => shopEntityClass(call, productIndex, categories()),
    originEntity: shopOriginEntity,
    injectorHook: injectorMiddleware,
    versionHeader: VERSION_HEADER,
    contractsPath: join(ROOT, 'packages/contracts/contracts/shop-mcp.contracts.json'),
    baseUrlEnv: 'VENDOR_BASE_URL',
    serverCommand: (dir) => ({
      command: join(dir, 'node_modules/.bin/tsx'),
      args: ['src/main.ts'],
      cwd: dir,
    }),
    repo: {
      slug: process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp',
      dir: () => process.env.FIKS_SHOP_DIR ?? join(ROOT, '.work', 'shop-mcp'),
    },
    seedTag: 'seed-v1',
    scenarios: SCENARIOS,
    fixtureCalls: FIXTURE_CALLS,
    tasks: parts.tasks ?? [],
    promptHints: {
      repair: [
        'src/tools/*.ts: one file per tool. src/vendor.ts: the HTTP client.',
        "vendor/openapi.json: the vendor's published spec.",
        'test/fixtures/v1/*.json: recordings against the base vendor version, which must keep producing the same output.',
        'Responses carry a vendor-api-version response header.',
        'Checks: pnpm typecheck, pnpm lint, pnpm test.',
      ],
      server: 'shop-mcp',
      extendedCatalog: DEFAULT_EXTENDED_CATALOG,
    },
    enumerate: shopEnumerate,
    paginatedEndpoints: SHOP_PAGINATED_ENDPOINTS,
    reproEmitter: parts.reproEmitter,
    suite: parts.suite,
    allowedEditPaths: SHOP_ALLOWED_EDIT_PATHS,
  };
}
