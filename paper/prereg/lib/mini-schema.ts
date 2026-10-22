// A small JSON Schema (2020-12 subset) validator for the pre-registration schemas.
// Supported keywords: $ref (local "#/$defs/..."), type, enum, const, required, properties,
// additionalProperties, items, minItems, uniqueItems, minimum, maximum, minLength, pattern, oneOf.
// Anything else in a schema is rejected, so a schema cannot silently rely on an unsupported keyword.

export type Schema = Record<string, unknown>;

const SUPPORTED = new Set([
  '$schema',
  '$id',
  '$defs',
  '$comment',
  '$ref',
  'title',
  'description',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'minLength',
  'pattern',
  'oneOf',
]);

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (typeof node !== 'object' || node === null) throw new Error(`bad $ref ${ref}`);
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'object' || node === null) throw new Error(`bad $ref ${ref}`);
  return node as Schema;
}

/** Returns a list of error strings (empty = valid). */
export function validate(value: unknown, schema: Schema, root: Schema = schema, at = '$'): string[] {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`schema keyword "${key}" at ${at} is not supported`);
  }
  if (typeof schema.$ref === 'string') return validate(value, resolveRef(root, schema.$ref), root, at);
  const errors: string[] = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeMatches(value, t))) {
      return [`${at}: expected ${types.join('|')}, got ${typeOf(value)}`];
    }
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matching = (schema.oneOf as Schema[]).filter((s) => validate(value, s, root, at).length === 0);
    if (matching.length !== 1) errors.push(`${at}: matches ${matching.length} oneOf branches, expected 1`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${at}: ${value} < minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${at}: ${value} > maximum ${schema.maximum}`);
    }
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${at}: fewer than ${schema.minItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) errors.push(`${at}: items are not unique`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => {
        errors.push(...validate(item, schema.items as Schema, root, `${at}[${i}]`));
      });
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const req of (schema.required ?? []) as string[]) {
      if (!(req in obj)) errors.push(`${at}: missing required "${req}"`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) {
        errors.push(...validate(v, props[k] as Schema, root, `${at}.${k}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${at}: unexpected property "${k}"`);
      } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        errors.push(...validate(v, schema.additionalProperties as Schema, root, `${at}.${k}`));
      }
    }
  }
  return errors;
}
