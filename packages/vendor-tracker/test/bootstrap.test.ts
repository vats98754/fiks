// Importing packages/cli/src/bootstrap/10-tracker.ts registers the tracker Domain; the shop
// registration (CORE's 00-shop.ts, when present) is unaffected. The type assertions below are
// checked by `pnpm typecheck` (tsc --noEmit over packages/*/test).
import { existsSync } from 'node:fs';
import { getDomain, listDomains } from '@fiks/domains';
import type { Domain } from '@fiks/interfaces';
import { expect, test } from 'vitest';

const SHOP_BOOTSTRAP = new URL('../../cli/src/bootstrap/00-shop.ts', import.meta.url).pathname;

/** Every member of Domain, required (a missing key here is a compile error). */
const MEMBERS: Record<keyof Domain, true> = {
  id: true,
  createVendor: true,
  frozenClock: true,
  truth: true,
  entityClass: true,
  originEntity: true,
  injectorHook: true,
  versionHeader: true,
  contractsPath: true,
  baseUrlEnv: true,
  serverCommand: true,
  repo: true,
  seedTag: true,
  scenarios: true,
  fixtureCalls: true,
  tasks: true,
  promptHints: true,
  enumerate: true,
  paginatedEndpoints: true,
  reproEmitter: true,
  suite: true,
  allowedEditPaths: true,
};

test("10-tracker.ts registers getDomain('tracker') with every Domain member; shop is unaffected", async () => {
  if (existsSync(SHOP_BOOTSTRAP)) await import(SHOP_BOOTSTRAP);
  const shopBefore = listDomains().find((d) => d.id === 'shop');
  expect(listDomains().some((d) => d.id === 'tracker')).toBe(false);

  await import('../../cli/src/bootstrap/10-tracker.ts');
  const tracker: Domain = getDomain('tracker');
  const { trackerDomain } = await import('@fiks/vendor-tracker');
  expect(tracker).toBe(trackerDomain);
  expect(tracker.id).toBe('tracker');
  for (const k of Object.keys(MEMBERS) as (keyof Domain)[]) {
    expect(tracker[k], `Domain.${k}`).toBeDefined();
    expect(tracker[k], `Domain.${k}`).not.toBeNull();
  }
  expect(typeof tracker.reproEmitter).toBe('function');
  expect(typeof tracker.suite.run).toBe('function');
  expect(tracker.suite.scope).toEqual(['**']);
  expect(tracker.allowedEditPaths).toEqual(['^src/.+\\.ts$']);
  expect(tracker.frozenClock).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(tracker.repo.dir()).toMatch(/\/\.work\/tracker-mcp$|^.+$/);

  // Registering again is a no-op; the shop entry (absent before CORE merges) is unchanged.
  await import('../../cli/src/bootstrap/10-tracker.ts');
  expect(listDomains().filter((d) => d.id === 'tracker')).toHaveLength(1);
  expect(listDomains().find((d) => d.id === 'shop')).toBe(shopBefore);
  if (!shopBefore) expect(() => getDomain('shop')).toThrow(/unknown domain "shop"/);
});
