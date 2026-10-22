// B-AJV (PLAN 6.1, X1): the strongest schema-only check. Ajv 2020-12 in strict mode with
// ajv-formats, on the tool output, against the declared outputSchema tightened with every
// constraint the specs let us derive mechanically:
//   1. closed objects: `additionalProperties: false` and every declared property required;
//   2. formats named in property descriptions (ISO-8601 -> date-time, URL/URI -> uri, e-mail -> email);
//   3. (optional) value constraints from the vendor's OpenAPI response schema for the upstream
//      operation the call hit, copied onto same-named output properties (format, minimum, maximum,
//      exclusive bounds, length, pattern, enum, item counts, multipleOf).
// No semantic invariant (unit, freshness, read-after-write) is derivable from a schema, which is the
// point of the baseline.
import type { JsonSchema } from '@fiks/contracts';
import type { MonitorInput, MonitorResult } from '@fiks/interfaces';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { SyncBaselineMonitor } from './types.ts';
import { canonicalJson } from './util.ts';

export const B_AJV_ID = 'B-AJV';
export const B_AJV_PROPERTY = 'B-AJV/strictSchema';

const COPY_KEYWORDS = [
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'enum',
  'minItems',
  'maxItems',
  'multipleOf',
] as const;

const DESCRIPTION_FORMATS: [RegExp, string][] = [
  [/\bISO[- ]?8601\b/i, 'date-time'],
  [/\b(URL|URI)\b/, 'uri'],
  [/\be-?mail address\b/i, 'email'],
];

type Schema = Record<string, unknown>;

const isObj = (v: unknown): v is Schema => v !== null && typeof v === 'object' && !Array.isArray(v);
const types = (s: Schema): string[] =>
  s.type === undefined ? [] : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];

/** Rules 1 and 2 (pure; returns a new schema). `$schema` is dropped: Ajv 2020-12 compiles it. */
export function strictify(schema: JsonSchema): JsonSchema {
  const visit = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(visit);
    if (!isObj(s)) return s;
    const out: Schema = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === '$schema') continue;
      out[k] =
        k === 'properties' && isObj(v)
          ? mapValues(v, visit)
          : k === 'enum' || k === 'required'
            ? v
            : visit(v);
    }
    if (isObj(out.properties)) {
      if (out.additionalProperties === undefined) out.additionalProperties = false;
      const required = Array.isArray(out.required) ? (out.required as string[]) : [];
      out.required = [...new Set([...required, ...Object.keys(out.properties)])];
    }
    if (types(out).includes('string') && out.format === undefined && typeof out.description === 'string') {
      const hit = DESCRIPTION_FORMATS.find(([re]) => re.test(out.description as string));
      if (hit) out.format = hit[1];
    }
    return out;
  };
  return visit(schema) as JsonSchema;
}

function mapValues(o: Record<string, unknown>, f: (v: unknown) => unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

/** Resolves local `#/...` refs of an OpenAPI document (no cycles in the specs used here). */
function deref(doc: unknown, s: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('OpenAPI $ref nesting too deep');
  if (Array.isArray(s)) return s.map((x) => deref(doc, x, depth + 1));
  if (!isObj(s)) return s;
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    let cur: unknown = doc;
    for (const part of s.$ref.slice(2).split('/')) cur = isObj(cur) ? cur[part] : undefined;
    return deref(doc, cur, depth + 1);
  }
  return mapValues(s, (v) => deref(doc, v, depth + 1));
}

export interface OpenApiOperation {
  operationId: string;
  /** The 2xx JSON response schema, refs resolved. */
  responseSchema: Schema | null;
}

/** The OpenAPI operation an upstream request hit (method + path template match), if any. */
export function findOperation(openapi: unknown, method: string, url: string): OpenApiOperation | null {
  if (!isObj(openapi) || !isObj(openapi.paths)) return null;
  const path = url.split('?')[0] ?? '';
  for (const [template, item] of Object.entries(openapi.paths)) {
    const re = new RegExp(
      `^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')}$`,
    );
    if (!re.test(path) || !isObj(item)) continue;
    const op = item[method.toLowerCase()];
    if (!isObj(op)) continue;
    const responses = isObj(op.responses) ? op.responses : {};
    const ok = Object.entries(responses).find(([code]) => /^2\d\d$/.test(code))?.[1];
    const content = isObj(ok) && isObj(ok.content) ? ok.content['application/json'] : undefined;
    const schema = isObj(content) ? deref(openapi, content.schema) : null;
    return {
      operationId: String(op.operationId ?? `${method} ${template}`),
      responseSchema: isObj(schema) ? schema : null,
    };
  }
  return null;
}

/** Rule 3: copy value constraints from `spec` onto same-named properties of `out` (pure). */
export function mergeSpecConstraints(out: JsonSchema, spec: JsonSchema): JsonSchema {
  const merge = (o: unknown, s: unknown): unknown => {
    if (!isObj(o) || !isObj(s)) return o;
    const r: Schema = { ...o };
    const compatible =
      types(r).length === 0 ||
      types(s).length === 0 ||
      types(s).some((t) => types(r).includes(t) || (t === 'integer' && types(r).includes('number')));
    if (compatible) for (const k of COPY_KEYWORDS) if (r[k] === undefined && s[k] !== undefined) r[k] = s[k];
    if (isObj(r.properties) && isObj(s.properties)) {
      const sp = s.properties;
      r.properties = Object.fromEntries(
        Object.entries(r.properties).map(([k, v]) => [k, k in sp ? merge(v, sp[k]) : v]),
      );
    }
    if (isObj(r.items) && isObj(s.items)) r.items = merge(r.items, s.items);
    return r;
  };
  return merge(out, spec) as JsonSchema;
}

export interface AjvMonitorOptions {
  /** The vendor's OpenAPI document, for rule 3. Omit to use the tool's outputSchema only. */
  openapi?: unknown;
}

/** The exact schema B-AJV compiles for one call (exported for tests and the fidelity log). */
export function strictSchemaFor(input: MonitorInput, opts: AjvMonitorOptions = {}): JsonSchema | null {
  const declared = input.toolDef?.outputSchema ?? input.declaredOutputSchema;
  if (!declared) return null;
  let schema = strictify(declared);
  const first = input.upstream?.[0];
  if (opts.openapi && first) {
    const op = findOperation(opts.openapi, first.request.method, first.request.url);
    if (op?.responseSchema) schema = mergeSpecConstraints(schema, op.responseSchema);
  }
  return schema;
}

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((e) => `${e.instancePath || '$'} ${e.message ?? e.keyword}`).join('; ');
}

/**
 * B-AJV monitor: `unverifiable` without a declared outputSchema or without structured data;
 * `violated` with one violation per Ajv error (allErrors), else `verified`.
 */
export function createAjvMonitor(opts: AjvMonitorOptions = {}): SyncBaselineMonitor {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  const cache = new Map<string, ValidateFunction>();
  const monitor = (input: MonitorInput): MonitorResult => {
    const schema = strictSchemaFor(input, opts);
    const data = input.result.structuredContent;
    if (!schema || input.result.isError)
      return { verdict: 'unverifiable', checked: [], violations: [], disabled: [] };
    const checked = [B_AJV_PROPERTY];
    if (data === undefined) {
      const violation = {
        propertyId: B_AJV_PROPERTY,
        kind: 'outputSchema',
        path: '$',
        expected: 'structuredContent',
        actual: null,
        message: 'no structured result, though the tool declares an output schema',
      };
      return { verdict: 'violated', checked, violations: [violation], disabled: [] };
    }
    const key = canonicalJson(schema);
    let validate = cache.get(key);
    if (!validate) {
      validate = ajv.compile(schema);
      cache.set(key, validate);
    }
    if (validate(data)) return { verdict: 'verified', checked, violations: [], disabled: [] };
    const violations = (validate.errors ?? []).map((e) => ({
      propertyId: B_AJV_PROPERTY,
      kind: e.keyword,
      path: e.instancePath || '$',
      expected: canonicalJson(e.params),
      actual: null,
      message: describeErrors([e]),
    }));
    return { verdict: 'violated', checked, violations, disabled: [] };
  };
  return Object.assign(monitor, { id: B_AJV_ID });
}
