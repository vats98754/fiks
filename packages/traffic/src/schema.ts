// A small JSON Schema check for tool-call arguments against the tool's declared inputSchema (the
// subset MCP servers emit from zod: type, properties, required, additionalProperties, items, enum,
// const, minimum/maximum, minItems/maxItems, minLength, anyOf/oneOf). It decides whether a held-out
// call is `valid`; it never changes the args.

export type JsonSchema = Record<string, unknown>;

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

const matchesType = (v: unknown, t: string): boolean => {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
};

const show = (v: unknown) => JSON.stringify(v)?.slice(0, 60) ?? String(v);

/** The first reason `value` does not satisfy `schema` at `path`, or null when it does. */
export function schemaError(schema: JsonSchema | undefined, value: unknown, path = '$'): string | null {
  if (!schema || typeof schema !== 'object') return null;
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.length > 0) {
      const errs = branches.map((b) => schemaError(b as JsonSchema, value, path));
      if (errs.every((e) => e !== null)) return errs[0] ?? `${path}: no ${key} branch matches`;
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const b of schema.allOf) {
      const e = schemaError(b as JsonSchema, value, path);
      if (e) return e;
    }
  }
  const t = schema.type;
  if (typeof t === 'string' && !matchesType(value, t)) return `${path}: expected ${t}, got ${typeOf(value)}`;
  if (Array.isArray(t) && !t.some((x) => typeof x === 'string' && matchesType(value, x)))
    return `${path}: expected ${t.join('|')}, got ${typeOf(value)}`;
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    return `${path}: expected ${show(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    return `${path}: ${show(value)} is not one of ${show(schema.enum)}`;
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path}: < ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path}: > ${schema.maximum}`;
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
      return `${path}: <= ${schema.exclusiveMinimum}`;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
      return `${path}: >= ${schema.exclusiveMaximum}`;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      return `${path}: shorter than ${schema.minLength}`;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      return `${path}: longer than ${schema.maxLength}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      return `${path}: fewer than ${schema.minItems} items`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      return `${path}: more than ${schema.maxItems} items`;
    const items = schema.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      for (const [i, x] of value.entries()) {
        const e = schemaError(items as JsonSchema, x, `${path}[${i}]`);
        if (e) return e;
      }
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const r of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof r === 'string' && !(r in obj)) return `${path}.${r}: required`;
    }
    for (const [k, v] of Object.entries(obj)) {
      const p = props[k];
      if (p) {
        const e = schemaError(p, v, `${path}.${k}`);
        if (e) return e;
      } else if (schema.additionalProperties === false) {
        return `${path}.${k}: not allowed`;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const e = schemaError(schema.additionalProperties as JsonSchema, v, `${path}.${k}`);
        if (e) return e;
      }
    }
  }
  return null;
}
