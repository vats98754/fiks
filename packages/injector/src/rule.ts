// InjectorRule: schema, validator, hash and loader (PLAN Appendix `InjectorRule`, P7).
//
// File format (`fixtures/rules/<id>.json`):
//   { id, domain, match: { method, pathPattern }, transform, clockFrozen, hash }
// - `match.method`: `*` or upper-case methods joined by `|` (e.g. `GET|POST`).
// - `match.pathPattern`: a JavaScript regex source tested against the request pathname (no query).
// - `transform`: path of the transform module, relative to the rule file's directory.
// - `hash`: `ruleHash()` = sha256 over the canonical rule (every field but `hash`) and the
//   transform module's bytes. A rule whose stored hash differs is refused by `startInjector`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InjectorRule } from '../../interfaces/src/drift.ts';
import type { InjectorTransform } from './transform.ts';

export type { InjectorRule };

/** A rule read from disk, with its transform resolved to an absolute path. */
export interface LoadedRule extends InjectorRule {
  /** Absolute path of the rule file ('' when the rule did not come from a file). */
  file: string;
  /** Absolute path of the transform module. */
  transformPath: string;
}

export const RULE_KEYS = ['id', 'domain', 'match', 'transform', 'clockFrozen', 'hash'] as const;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*$/;
const METHOD_RE = /^(\*|[A-Z]+(\|[A-Z]+)*)$/;
const HASH_RE = /^[0-9a-f]{64}$/;
/** A value import (not `import type`) or a re-export with a source: transforms may not have one. */
const VALUE_IMPORT_RE =
  /^\s*(import(?!\s+type\b)[^;]*?\bfrom\s*['"]|import\s*['"]|export\s+(?!type\b)[^;]*?\bfrom\s*['"])/m;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON with object keys sorted at every level (the hash input). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObject(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Structural checks on a parsed rule file. Returns the problems (empty = valid). */
export function ruleSchemaErrors(raw: unknown): string[] {
  if (!isObject(raw)) return ['rule must be a JSON object'];
  const errs: string[] = [];
  for (const k of Object.keys(raw)) {
    if (!(RULE_KEYS as readonly string[]).includes(k)) errs.push(`unknown field "${k}"`);
  }
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id))
    errs.push('id must match [A-Za-z0-9][A-Za-z0-9._-]*');
  if (typeof raw.domain !== 'string' || !DOMAIN_RE.test(raw.domain)) {
    errs.push('domain must match [a-z0-9][a-z0-9-]*');
  }
  const m = raw.match;
  if (!isObject(m)) {
    errs.push('match must be an object {method, pathPattern}');
  } else {
    for (const k of Object.keys(m)) {
      if (k !== 'method' && k !== 'pathPattern') errs.push(`unknown field "match.${k}"`);
    }
    if (typeof m.method !== 'string' || !METHOD_RE.test(m.method)) {
      errs.push('match.method must be "*" or upper-case methods joined by "|"');
    }
    if (typeof m.pathPattern !== 'string' || !m.pathPattern) {
      errs.push('match.pathPattern must be a non-empty regex source');
    } else {
      try {
        new RegExp(m.pathPattern);
      } catch (e) {
        errs.push(`match.pathPattern does not compile: ${(e as Error).message}`);
      }
    }
  }
  if (typeof raw.transform !== 'string' || !raw.transform.endsWith('.ts')) {
    errs.push('transform must be a path to a .ts module');
  }
  if (typeof raw.clockFrozen !== 'boolean') errs.push('clockFrozen must be a boolean');
  if (typeof raw.hash !== 'string' || !HASH_RE.test(raw.hash))
    errs.push('hash must be 64 lower-case hex chars');
  return errs;
}

/** sha256(canonical rule without `hash` + "\n" + transform module bytes). */
export function ruleHash(
  rule: Omit<InjectorRule, 'hash'> & { hash?: string },
  transformPath: string,
): string {
  const { hash: _ignored, ...rest } = rule;
  const body = canonicalJson({
    id: rest.id,
    domain: rest.domain,
    match: { method: rest.match.method, pathPattern: rest.match.pathPattern },
    transform: rest.transform,
    clockFrozen: rest.clockFrozen,
  });
  return sha256(Buffer.concat([Buffer.from(`${body}\n`), readFileSync(transformPath)]));
}

export function resolveTransformPath(rule: Pick<InjectorRule, 'transform'>, ruleDir: string): string {
  return isAbsolute(rule.transform) ? rule.transform : resolve(ruleDir, rule.transform);
}

export class RuleError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`${file || 'rule'}: ${problems.join('; ')}`);
  }
}

/** Reads and schema-checks a rule file (no hash check; see `validateRule`). */
export function readRule(file: string): LoadedRule {
  const abs = resolve(file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new RuleError(abs, [`cannot read JSON: ${(e as Error).message}`]);
  }
  const errs = ruleSchemaErrors(raw);
  if (errs.length) throw new RuleError(abs, errs);
  const rule = raw as unknown as InjectorRule;
  return { ...rule, file: abs, transformPath: resolveTransformPath(rule, dirname(abs)) };
}

export function isTransform(v: unknown): v is InjectorTransform {
  if (!isObject(v)) return false;
  if (typeof v.description !== 'string' || typeof v.response !== 'function') return false;
  if (v.setHeaders === undefined) return true;
  return isObject(v.setHeaders) && Object.values(v.setHeaders).every((x) => typeof x === 'string');
}

/** Imports the transform module and checks its default export. */
export async function loadTransform(transformPath: string): Promise<InjectorTransform> {
  const mod = (await import(pathToFileURL(transformPath).href)) as { default?: unknown };
  if (!isTransform(mod.default)) {
    throw new RuleError(transformPath, [
      'default export must be {description: string, response(req, res, ctx), setHeaders?}',
    ]);
  }
  return mod.default;
}

/** Full validation: schema, transform file, self-containment, default export and hash. */
export async function validateRule(file: string): Promise<{ rule?: LoadedRule; errors: string[] }> {
  let rule: LoadedRule;
  try {
    rule = readRule(file);
  } catch (e) {
    return { errors: e instanceof RuleError ? e.problems : [String(e)] };
  }
  const errors: string[] = [];
  if (!existsSync(rule.transformPath)) {
    return { rule, errors: [`transform not found: ${rule.transformPath}`] };
  }
  const src = readFileSync(rule.transformPath, 'utf8');
  if (VALUE_IMPORT_RE.test(src)) {
    errors.push('transform must be self-contained (only `import type` is allowed)');
  }
  try {
    await loadTransform(rule.transformPath);
  } catch (e) {
    errors.push(e instanceof RuleError ? e.problems.join('; ') : `cannot load transform: ${String(e)}`);
  }
  const want = ruleHash(rule, rule.transformPath);
  if (rule.hash !== want) errors.push(`hash mismatch: file has ${rule.hash}, computed ${want}`);
  return { rule, errors };
}

/** Compiles `match` into a predicate over (method, pathname). */
export function matcher(match: InjectorRule['match']): (method: string, path: string) => boolean {
  const methods = match.method === '*' ? null : new Set(match.method.split('|'));
  const re = new RegExp(match.pathPattern);
  return (method, path) => (methods === null || methods.has(method.toUpperCase())) && re.test(path);
}
