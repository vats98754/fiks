// Drift inputs of a block run: the dev split (D1-D5, DEV-X1, TRK-DEV-1 and the dev blind drifts
// once the R0 split exists) or a manifest written by an earlier run step (F9 eligible list for
// R3/R4/R11, benign cases for R6, carriers for R7, real bugs for R8).

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface DriftInput {
  id: string;
  domain: string;
  /** Local server ref (DriftPackage.base), peeled by the arm; never fetched. */
  base: string;
  /** DriftPackage used by `fiks record --drift` (injector rule); null for manifest inputs. */
  recordPkg: string | null;
  /** DriftPackage / HOLD manifest used by `fiks grade --pkg`. */
  gradePkg: string | null;
  /** Frozen trace; null until the prepare phase (record + freeze-trace) has produced it. */
  trace: string | null;
  stratum: string;
  /** ISSUE-TEXT input (R8). */
  issue?: string;
  /** FIKS+CU clean v1 corpus (R6). */
  cleanCorpus?: string;
  /** Stub fix script for --dry. */
  stubFix?: string;
}

interface DevEntry {
  id: string;
  domain: string;
  base: string;
  recordPkg: string;
  gradePkg: string;
}

/** Built-in dev drifts (PLAN 5.1): record via INJ/DOM2 packages, grade via HOLD/DOM2 packages. */
export const DEV_BUILTIN: DevEntry[] = [
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `D${n}`,
    domain: 'shop',
    base: 'seed-v1',
    recordPkg: `packages/injector/fixtures/driftpkgs/D${n}.json`,
    gradePkg: `packages/heldout/fixtures/dev/D${n}/manifest.json`,
  })),
  {
    id: 'DEV-X1',
    domain: 'shop',
    base: 'base-shop',
    recordPkg: 'packages/injector/fixtures/driftpkgs/DEV-X1.json',
    gradePkg: 'packages/heldout/fixtures/dev/DEV-X1/manifest.json',
  },
  {
    id: 'TRK-DEV-1',
    domain: 'tracker',
    base: 'dev-tracker-stub',
    recordPkg: 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json',
    gradePkg: 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json',
  },
];

const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;

function checkId(id: string, where: string): string {
  if (!SAFE_ID.test(id))
    throw new Error(`${where}: drift id ${JSON.stringify(id)} is not a safe run-key part`);
  return id;
}

/** Reads the base of a DriftPackage when the file exists (the package is authoritative). */
function baseOf(root: string, pkg: string, fallback: string): string {
  const f = join(root, pkg);
  if (!existsSync(f)) return fallback;
  const j = JSON.parse(readFileSync(f, 'utf8')) as { base?: unknown };
  return str(j.base) ? j.base : fallback;
}

/** Dev split: the built-ins plus the dev entries of the R0 split file when it exists. */
export function devInputs(root: string, splitFile: string | null, stubDir: string): DriftInput[] {
  const out: DriftInput[] = DEV_BUILTIN.map((d) => ({
    id: d.id,
    domain: d.domain,
    base: baseOf(root, d.recordPkg, d.base),
    recordPkg: d.recordPkg,
    gradePkg: d.gradePkg,
    trace: null,
    stratum: 'dev',
    stubFix: join(stubDir, `${d.id}.json`),
  }));
  if (splitFile && existsSync(splitFile)) {
    const j = JSON.parse(readFileSync(splitFile, 'utf8')) as { dev?: unknown };
    if (!Array.isArray(j.dev)) throw new Error(`${splitFile}: want {dev: [...]}`);
    for (const [i, e] of (j.dev as Record<string, unknown>[]).entries()) {
      const where = `${splitFile} dev[${i}]`;
      if (!str(e.id) || !str(e.domain) || !str(e.base) || !str(e.pkg))
        throw new Error(`${where}: want {id, domain, base, pkg}`);
      if (out.some((d) => d.id === e.id)) continue;
      out.push({
        id: checkId(e.id, where),
        domain: e.domain,
        base: e.base,
        recordPkg: e.pkg,
        gradePkg: e.pkg,
        trace: null,
        stratum: str(e.stratum) ? e.stratum : 'dev-blind',
        stubFix: join(stubDir, 'noop.json'),
      });
    }
  }
  return out;
}

/**
 * A manifest written by an earlier run step: `{drifts: [...]}` or a bare array of
 * {id, domain, base, trace, pkg?, stratum?, issue?, cleanCorpus?}. Relative paths resolve
 * against the manifest's folder.
 */
export function manifestInputs(file: string, stubDir: string): DriftInput[] {
  if (!existsSync(file)) throw new Error(`input manifest not found: ${file}`);
  const j = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const rows = Array.isArray(j) ? j : (j as { drifts?: unknown }).drifts;
  if (!Array.isArray(rows)) throw new Error(`${file}: want {drifts: [...]} or an array`);
  const dir = resolve(file, '..');
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(dir, p));
  const seen = new Set<string>();
  return (rows as Record<string, unknown>[]).map((e, i) => {
    const where = `${file} [${i}]`;
    if (!str(e.id) || !str(e.domain) || !str(e.base) || !str(e.trace))
      throw new Error(`${where}: want {id, domain, base, trace}`);
    if (seen.has(e.id)) throw new Error(`${where}: duplicate drift id ${e.id}`);
    seen.add(e.id);
    return {
      id: checkId(e.id, where),
      domain: e.domain,
      base: e.base,
      recordPkg: str(e.pkg) ? abs(e.pkg) : null,
      gradePkg: str(e.pkg) ? abs(e.pkg) : null,
      trace: abs(e.trace),
      stratum: str(e.stratum) ? e.stratum : 'test',
      ...(str(e.issue) ? { issue: abs(e.issue) } : {}),
      ...(str(e.cleanCorpus) ? { cleanCorpus: abs(e.cleanCorpus) } : {}),
      stubFix: join(stubDir, str(e.stub) ? e.stub : 'noop.json'),
    };
  });
}

/** --drifts: keep the named ids, in the given input order; unknown ids are an error. */
export function filterDrifts(all: DriftInput[], ids: string[] | null): DriftInput[] {
  if (!ids) return all;
  const known = new Set(all.map((d) => d.id));
  const unknown = ids.filter((i) => !known.has(i));
  if (unknown.length) throw new Error(`--drifts: unknown drift id(s) ${unknown.join(', ')}`);
  const want = new Set(ids);
  return all.filter((d) => want.has(d.id));
}
