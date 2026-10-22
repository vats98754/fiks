// DriftPackage manifests (PLAN Appendix `DriftPackage`). INJ ships the injector part of each
// dev manifest (id, domain, base, stratum, family, injector rule); HOLD fills hiddenTests, refA,
// refB, renamedIdVariant and generators in its own full copies. Paths inside a manifest are
// relative to the manifest's directory.
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { DriftPackage } from '../../interfaces/src/drift.ts';
import { type LoadedRule, readRule, validateRule } from './rule.ts';

export type { DriftPackage };

export const DRIFTPKG_KEYS = [
  'id',
  'domain',
  'base',
  'stratum',
  'ideationFamily',
  'authorSession',
  'injectorRule',
  'hiddenTests',
  'refA',
  'refB',
  'renamedIdVariant',
  'generators',
  'changelog',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

export interface DriftPkgCheckOptions {
  /** Also require the grader part (≥ 1 hidden test, refA, refB, renamedIdVariant). */
  complete?: boolean;
}

/** Structural checks on a parsed manifest. Returns the problems (empty = valid). */
export function driftPkgSchemaErrors(raw: unknown, opts: DriftPkgCheckOptions = {}): string[] {
  if (!isObject(raw)) return ['manifest must be a JSON object'];
  const errs: string[] = [];
  for (const k of Object.keys(raw)) {
    if (!(DRIFTPKG_KEYS as readonly string[]).includes(k)) errs.push(`unknown field "${k}"`);
  }
  for (const k of ['id', 'domain', 'base', 'stratum', 'ideationFamily', 'authorSession'] as const) {
    if (!nonEmpty(raw[k])) errs.push(`${k} must be a non-empty string`);
  }
  const ir = raw.injectorRule;
  if (!isObject(ir) || !nonEmpty(ir.path) || typeof ir.hash !== 'string') {
    errs.push('injectorRule must be {path, hash}');
  } else {
    for (const k of Object.keys(ir))
      if (k !== 'path' && k !== 'hash') errs.push(`unknown field "injectorRule.${k}"`);
  }
  if (!isStringArray(raw.hiddenTests)) errs.push('hiddenTests must be a string array');
  if (!isStringArray(raw.generators)) errs.push('generators must be a string array');
  for (const k of ['refA', 'refB', 'renamedIdVariant'] as const) {
    if (typeof raw[k] !== 'string') errs.push(`${k} must be a string`);
  }
  if (raw.changelog !== undefined && typeof raw.changelog !== 'string')
    errs.push('changelog must be a string');
  if (opts.complete) {
    if (!isStringArray(raw.hiddenTests) || raw.hiddenTests.length === 0) errs.push('hiddenTests is empty');
    for (const k of ['refA', 'refB', 'renamedIdVariant'] as const) {
      if (!nonEmpty(raw[k])) errs.push(`${k} is empty`);
    }
  }
  return errs;
}

export interface LoadedDriftPackage {
  file: string;
  pkg: DriftPackage;
  /** Absolute path of the injector rule file. */
  rulePath: string;
  rule: LoadedRule;
}

/** Reads a manifest and its rule (schema-checked; hashes are checked by `validateDriftPackage`). */
export function loadDriftPackage(file: string): LoadedDriftPackage {
  const abs = resolve(file);
  const raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
  const errs = driftPkgSchemaErrors(raw);
  if (errs.length) throw new Error(`${abs}: ${errs.join('; ')}`);
  const pkg = raw as DriftPackage;
  const rulePath = isAbsolute(pkg.injectorRule.path)
    ? pkg.injectorRule.path
    : resolve(dirname(abs), pkg.injectorRule.path);
  return { file: abs, pkg, rulePath, rule: readRule(rulePath) };
}

/** Full validation: schema, the rule (incl. its own hash), and manifest hash = rule hash, same ids. */
export async function validateDriftPackage(
  file: string,
  opts: DriftPkgCheckOptions = {},
): Promise<{ pkg?: DriftPackage; errors: string[] }> {
  const abs = resolve(file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    return { errors: [`cannot read JSON: ${(e as Error).message}`] };
  }
  const errors = driftPkgSchemaErrors(raw, opts);
  if (errors.length) return { errors };
  const pkg = raw as DriftPackage;
  const rulePath = isAbsolute(pkg.injectorRule.path)
    ? pkg.injectorRule.path
    : resolve(dirname(abs), pkg.injectorRule.path);
  const r = await validateRule(rulePath);
  errors.push(...r.errors.map((e) => `injectorRule ${pkg.injectorRule.path}: ${e}`));
  if (r.rule) {
    if (r.rule.hash !== pkg.injectorRule.hash) {
      errors.push(`injectorRule.hash ${pkg.injectorRule.hash} != rule hash ${r.rule.hash}`);
    }
    if (r.rule.domain !== pkg.domain)
      errors.push(`rule domain ${r.rule.domain} != manifest domain ${pkg.domain}`);
    if (r.rule.id !== pkg.id) errors.push(`rule id ${r.rule.id} != manifest id ${pkg.id}`);
  }
  return { pkg, errors };
}
