// The operator catalog (../catalog.json) and its hash. The hash is sha256 of the canonical JSON of
// the catalog without its `hash` field; the catalog's `implementation` map pins sha256 of every
// source file and prompt, so a change to an operator's code or prompt changes the hash too.
import { readdirSync, readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from './util.ts';

export const PACKAGE_DIR = new URL('../', import.meta.url);
export const CATALOG_PATH = new URL('catalog.json', PACKAGE_DIR);

export type Catalog = Record<string, unknown> & { implementation: Record<string, string>; hash: string };

export const readCatalog = (): Catalog => JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog;

/** Package-relative paths whose bytes define the operators: src/*.ts and prompts/*.md. */
export function implementationFiles(): string[] {
  const list = (dir: string, ext: string) =>
    readdirSync(new URL(`${dir}/`, PACKAGE_DIR))
      .filter((f) => f.endsWith(ext))
      .map((f) => `${dir}/${f}`);
  return [...list('src', '.ts'), ...list('prompts', '.md')].sort();
}

/** sha256 of each implementation file, as stored under `implementation`. */
export function implementationHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of implementationFiles()) out[f] = sha256(readFileSync(new URL(f, PACKAGE_DIR)));
  return out;
}

/** The hash of a catalog object (its `hash` field is ignored). */
export function catalogHash(c: Record<string, unknown>): string {
  const { hash: _ignored, ...rest } = c;
  return sha256(canonicalJson(rest));
}

export interface CatalogCheck {
  ok: boolean;
  stored: string;
  computed: string;
  /** Implementation files whose sha256 differs from the catalog, or that are missing/extra. */
  stale: string[];
}

/** Checks the stored hash and the implementation map against the files on disk. */
export function checkCatalog(c: Catalog = readCatalog()): CatalogCheck {
  const now = implementationHashes();
  const stored = c.implementation ?? {};
  const stale = [...new Set([...Object.keys(now), ...Object.keys(stored)])]
    .filter((f) => now[f] !== stored[f])
    .sort();
  const computed = catalogHash(c);
  return { ok: stale.length === 0 && computed === c.hash, stored: c.hash, computed, stale };
}

/** The catalog with `implementation` and `hash` recomputed from the files on disk. */
export function refreshCatalog(c: Catalog = readCatalog()): Catalog {
  const next: Catalog = { ...c, implementation: implementationHashes(), hash: '' };
  next.hash = catalogHash(next);
  return next;
}
