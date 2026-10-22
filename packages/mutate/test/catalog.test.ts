// catalog.json lists every operator, points at committed prompts, and its stored hash matches the
// files on disk; catalog-hash.ts prints it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { checkCatalog, readCatalog } from '../src/catalog.ts';
import { BENIGN_OPS, PATCH_OPS, RESPONSE_OPS } from '../src/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('catalog lists M1-M14, B1-B4 and P1-P8 with committed prompts', () => {
  const c = readCatalog() as unknown as {
    response: { id: string; definition: string }[];
    benign: { id: string; definition: string }[];
    patch: { id: string; prompt: string }[];
    patchFrame: { system: string; user: string };
  };
  expect(c.response.map((o) => o.id)).toEqual([...RESPONSE_OPS]);
  expect(c.benign.map((o) => o.id)).toEqual([...BENIGN_OPS]);
  expect(c.patch.map((o) => o.id)).toEqual([...PATCH_OPS]);
  for (const o of [...c.response, ...c.benign]) expect(o.definition.length).toBeGreaterThan(10);
  for (const p of [...c.patch.map((o) => o.prompt), c.patchFrame.system, c.patchFrame.user]) {
    expect(existsSync(new URL(`../${p}`, import.meta.url)), p).toBe(true);
  }
});

test('stored hash and implementation hashes are current', () => {
  const r = checkCatalog();
  expect(r.stale, 'run: pnpm tsx packages/mutate/src/catalog-hash.ts --write').toEqual([]);
  expect(r.computed).toBe(r.stored);
  expect(r.stored).toMatch(/^[0-9a-f]{64}$/);
});

test('catalog-hash.ts prints the hash', { timeout: 30_000 }, () => {
  const out = execFileSync(`${ROOT}node_modules/.bin/tsx`, ['packages/mutate/src/catalog-hash.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  expect(out).toBe(readCatalog().hash);
});
