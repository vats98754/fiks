// Loading a full DriftPackage for grading (PLAN Appendix `DriftPackage`, 5.8): the manifest is
// checked with INJ's validator (schema, rule hash, ids, grader part complete), and every path is
// resolved against the manifest's directory. The injector rule comes back as a LoadedRule.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { type LoadedRule, loadDriftPackage, validateDriftPackage } from '@fiks/injector';
import type { DriftPackage, RerecordProfile } from '@fiks/interfaces';
import { canonicalJson, sha256 } from './hash.ts';

export interface RenameRule {
  pattern: string;
  replace: string;
}

/** `<renamedIdVariant>/rename.json`: how the grader renames ids on the live upstream. */
export interface RenameSpec {
  /** Applied to upstream responses (vendor ids -> renamed ids). */
  forward: RenameRule[];
  /** Applied to requests (renamed ids -> vendor ids). */
  inverse: RenameRule[];
}

export interface HiddenFile {
  /** File name, e.g. `order-single.test.ts`. */
  name: string;
  /** Absolute path on the host. */
  path: string;
}

export interface LoadedPackage {
  file: string;
  dir: string;
  pkg: DriftPackage;
  rule: LoadedRule;
  /** Absolute paths. */
  refA: string;
  refB: string;
  hidden: HiddenFile[];
  renamed: HiddenFile[];
  rename: RenameSpec | null;
  generators: string[];
  /** sha256 over the manifest, the rule, both refs, every hidden and renamed test and generator. */
  hash: string;
}

const isTest = (f: string) => /\.test\.[cm]?[jt]s$/.test(f);

function listTests(dir: string): HiddenFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isTest)
    .sort()
    .map((name) => ({ name, path: join(dir, name) }));
}

/** Reads and validates a complete manifest (throws listing every problem). */
export async function loadPackage(file: string): Promise<LoadedPackage> {
  const abs = resolve(file);
  const v = await validateDriftPackage(abs, { complete: true });
  if (v.errors.length) throw new Error(`${abs}: ${v.errors.join('; ')}`);
  const { pkg, rule } = loadDriftPackage(abs);
  const dir = dirname(abs);
  const at = (p: string) => resolve(dir, p);
  const hidden = pkg.hiddenTests.map((p) => ({ name: basename(p), path: at(p) }));
  const variant = at(pkg.renamedIdVariant);
  const renamed = existsSync(variant) && statSync(variant).isDirectory() ? listTests(variant) : [];
  if (renamed.length === 0) throw new Error(`${abs}: renamedIdVariant ${pkg.renamedIdVariant} has no tests`);
  const renameFile = join(variant, 'rename.json');
  const rename = existsSync(renameFile) ? (JSON.parse(readFileSync(renameFile, 'utf8')) as RenameSpec) : null;
  for (const p of [at(pkg.refA), at(pkg.refB), ...hidden.map((h) => h.path)]) {
    if (!existsSync(p)) throw new Error(`${abs}: ${p} does not exist`);
  }
  const generators = pkg.generators.map(at);
  const parts = [
    abs,
    rule.file,
    rule.transformPath,
    at(pkg.refA),
    at(pkg.refB),
    ...hidden.map((h) => h.path),
    ...renamed.map((h) => h.path),
    ...(rename ? [renameFile] : []),
    ...generators,
  ];
  const hash = sha256(
    canonicalJson(parts.map((p) => [p === abs ? 'manifest' : basename(p), sha256(readFileSync(p))])),
  );
  return {
    file: abs,
    dir,
    pkg,
    rule,
    refA: at(pkg.refA),
    refB: at(pkg.refB),
    hidden,
    renamed,
    rename,
    generators,
    hash,
  };
}

/** The drift's re-record profile (P7): vendor base version v1 plus the injector rule. */
export function profileOf(p: LoadedPackage): RerecordProfile {
  return { domain: p.pkg.domain, base: 'v1', ruleId: p.rule.id, ruleHash: p.rule.hash };
}
