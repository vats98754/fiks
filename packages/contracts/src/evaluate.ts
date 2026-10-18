import type {
  ContractFile,
  EvalInput,
  EvalResult,
  Invariant,
  JsonSchema,
  Path,
  ReadAfterWrite,
  ToolContract,
  Violation,
} from './types.ts';

const DAY_MS = 86_400_000;

/** Every value at `path`, with its concrete location (`items[3].price`). */
export function select(root: unknown, path: Path): { at: string; value: unknown }[] {
  let cur: { at: string; value: unknown }[] = [{ at: '', value: root }];
  for (const seg of path.split('.')) {
    const wild = seg.endsWith('[*]');
    const key = wild ? seg.slice(0, -3) : seg;
    const next: { at: string; value: unknown }[] = [];
    for (const { at, value } of cur) {
      const child =
        value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      const here = at ? `${at}.${key}` : key;
      if (!wild) next.push({ at: here, value: child });
      else if (Array.isArray(child)) {
        for (const [i, v] of child.entries()) next.push({ at: `${here}[${i}]`, value: v });
      }
    }
    cur = next;
  }
  return cur;
}

export function getOne(root: unknown, path: Path): unknown {
  return select(root, path)[0]?.value;
}

function isSubset(pattern: Record<string, unknown>, actual: unknown): boolean {
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(pattern).every(
    ([k, v]) => JSON.stringify((actual as Record<string, unknown>)[k]) === JSON.stringify(v),
  );
}

export function isKnownGood(contract: ToolContract, args: unknown): boolean {
  return (contract.knownGoodInputs ?? []).some((p) => isSubset(p, args));
}

export function findContract(file: ContractFile, tool: string): ToolContract | undefined {
  return file.contracts.find((c) => c.tool === tool);
}

/** Arguments for the read-after-write probe, taken from the mutating call's result. */
export function buildProbeArgs(post: ReadAfterWrite, structured: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(post.probeArgs)) out[name] = getOne(structured, path);
  return out;
}

/** The value at a concrete location such as `items[3].price`. */
function lookup(root: unknown, at: string): unknown {
  let cur: unknown = root;
  for (const part of at.split('.')) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (m[1])
      cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[m[1]] : undefined;
    for (const idx of (m[2] ?? '').match(/\d+/g) ?? [])
      cur = Array.isArray(cur) ? cur[Number(idx)] : undefined;
  }
  return cur;
}

/** `items[3].price` -> the item's id when it has one (`p-1001`), else the location itself. */
function label(root: unknown, at: string): string {
  const dot = at.lastIndexOf('.');
  if (dot === -1) return at;
  const parent = lookup(root, at.slice(0, dot));
  const id =
    parent !== null && typeof parent === 'object' ? (parent as Record<string, unknown>).id : undefined;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : at;
}

const dateOnly = (v: unknown) => {
  const t = toTime(v);
  return t === null ? show(v) : new Date(t).toISOString().slice(0, 10);
};
const toMinute = (v: unknown) => {
  const t = toTime(v);
  return t === null ? show(v) : `${new Date(t).toISOString().slice(0, 16)}Z`;
};

/** Arguments as plain words: `{"id":"p-1001"}` -> `p-1001`. */
const argText = (args: unknown) =>
  args !== null && typeof args === 'object'
    ? Object.values(args).map(show).join(', ').replace(/"/g, '')
    : show(args);

function show(v: unknown): string {
  return v === undefined ? 'undefined' : JSON.stringify(v);
}

function toTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Minimal JSON Schema check: type, required, properties, items, enum. Returns the first mismatch. */
export function schemaMismatch(schema: JsonSchema, value: unknown, at = '$'): string | null {
  const anyOf = schema.anyOf as JsonSchema[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const misses = anyOf.map((s) => schemaMismatch(s, value, at));
    if (misses.every((m) => m !== null)) return misses.join(' and ');
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const ok = allowed.includes(t) || (t === 'integer' && allowed.includes('number'));
    if (!ok) return `${at} is ${t}, expected ${allowed.join('|')}`;
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    return `${at} = ${show(value)} is not one of ${show(schema.enum)}`;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in obj)) return `${at}.${r} is missing`;
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in obj) {
        const m = schemaMismatch(sub, obj[k], `${at}.${k}`);
        if (m) return m;
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const m = schemaMismatch(schema.items, value[i], `${at}[${i}]`);
      if (m) return m;
    }
  }
  return null;
}

function checkInvariant(
  c: ToolContract,
  inv: Invariant,
  data: unknown,
  input: EvalInput,
): Violation | null | 'skip' {
  const propertyId = `${c.id}/${inv.id}`;
  const v = (path: string, expected: string, actual: unknown, message: string): Violation => ({
    propertyId,
    kind: inv.kind,
    path,
    expected,
    actual,
    message,
  });

  switch (inv.kind) {
    case 'range': {
      const unit = inv.unit ? ` ${inv.unit}` : '';
      const expected =
        inv.max === undefined ? `at least ${inv.min}${unit}` : `${inv.min ?? '-inf'}-${inv.max}${unit}`;
      const values = select(data, inv.path).filter((x) => typeof x.value === 'number'); // null is notNull's job
      const bad = values.filter(
        ({ value }) =>
          (inv.min !== undefined && (value as number) < inv.min) ||
          (inv.max !== undefined && (value as number) > inv.max),
      );
      const first = bad[0];
      if (!first) return null;
      const field = inv.path.split('.').pop() ?? inv.path;
      const message =
        values.length === 1
          ? `${first.at} = ${first.value} is outside ${expected}`
          : `${bad.length} of ${values.length} ${field}s outside ${expected} (${label(data, first.at)} = ${first.value})`;
      return v(first.at, expected, first.value, message);
    }
    case 'notNull':
    case 'nonEmpty': {
      if (inv.onlyKnownGood && !isKnownGood(c, input.args)) return 'skip';
      for (const { at, value } of select(data, inv.path)) {
        if (inv.kind === 'notNull' && (value === null || value === undefined)) {
          return v(
            at,
            'not null',
            value ?? null,
            `${at} is null, but ${argText(input.args)} should have one`,
          );
        }
        if (inv.kind === 'nonEmpty' && (!Array.isArray(value) || value.length === 0)) {
          return v(
            at,
            'non-empty array',
            value,
            `${at} is empty, but ${argText(input.args)} should have results`,
          );
        }
      }
      return null;
    }
    case 'countMatchesTotal': {
      const items = getOne(data, inv.itemsPath);
      const total = getOne(data, inv.totalPath);
      if (!Array.isArray(items) || typeof total !== 'number') return 'skip';
      if (items.length === total) return null;
      return v(
        inv.itemsPath,
        `${inv.itemsPath}.length == ${inv.totalPath} (${total})`,
        items.length,
        `list is incomplete, ${items.length} of ${total} matches returned`,
      );
    }
    case 'equalsUpstream': {
      const first = input.upstream?.[0];
      if (!first) return 'skip';
      let upstream: unknown;
      try {
        upstream = JSON.parse(first.response.body);
      } catch {
        return 'skip';
      }
      const want = getOne(upstream, inv.upstreamPath);
      if (want === undefined) return 'skip';
      const got = getOne(data, inv.path);
      const same =
        inv.compare === 'instant'
          ? toTime(got) !== null && toTime(got) === toTime(want)
          : JSON.stringify(got) === JSON.stringify(want);
      if (same) return null;
      return v(
        inv.path,
        `${show(want)} (upstream ${inv.upstreamPath})`,
        got,
        inv.compare === 'instant'
          ? `${inv.path} shows ${dateOnly(got)} but upstream sent ${toMinute(want)}`
          : `${inv.path} = ${show(got)} but upstream sent ${show(want)}`,
      );
    }
    case 'unique': {
      const seen = new Map<string, string>();
      for (const { at, value } of select(data, inv.path)) {
        const key = JSON.stringify(value);
        const first = seen.get(key);
        if (first !== undefined)
          return v(at, 'unique values', value, `${at} = ${show(value)} repeats ${first}`);
        seen.set(key, at);
      }
      return null;
    }
    case 'freshness': {
      const now = input.now.getTime();
      const lo = now - inv.maxAgeDays * DAY_MS;
      const hi = now + (inv.maxFutureDays ?? 1) * DAY_MS;
      const expected = `within ${inv.maxAgeDays} days before and ${inv.maxFutureDays ?? 1} after now`;
      for (const { at, value } of select(data, inv.path)) {
        const t = toTime(value);
        if (t === null) return v(at, expected, value, `${at} = ${show(value)} is not a timestamp`);
        if (t < lo || t > hi) {
          const days = Math.round((now - t) / DAY_MS);
          const when = days >= 0 ? `${days} days old` : `${-days} days in the future`;
          return v(at, expected, value, `${at} shows ${dateOnly(value)}, ${when}`);
        }
      }
      return null;
    }
  }
}

function checkReadAfterWrite(
  c: ToolContract,
  post: ReadAfterWrite,
  data: unknown,
  input: EvalInput,
): Violation | null {
  const propertyId = `${c.id}/${post.id}`;
  const probe = input.probe;
  const base = { propertyId, kind: 'readAfterWrite', path: post.probeTool };
  if (!probe || probe.tool !== post.probeTool) {
    return { ...base, expected: 'probe result', actual: null, message: `no ${post.probeTool} probe ran` };
  }
  const args = Object.values((probe.args ?? {}) as Record<string, unknown>)
    .map(String)
    .join(', ');
  if (probe.result.isError || !probe.result.structuredContent) {
    return {
      ...base,
      expected: 'probe reads back the write',
      actual: probe.result.isError ? 'error' : 'no structuredContent',
      message: `not found on read-back: ${post.probeTool} ${args} returned ${probe.result.isError ? 'an error' : 'no data'}`,
    };
  }
  if (post.upstream && probe.upstream) {
    const want = getOne(data, post.upstream.equalsResultPath);
    const idPath = post.upstream.idPath;
    const confirmed = probe.upstream.some((x) => {
      if (x.response.status < 200 || x.response.status > 299) return false;
      try {
        return JSON.stringify(getOne(JSON.parse(x.response.body), idPath)) === JSON.stringify(want);
      } catch {
        return false;
      }
    });
    if (!confirmed) {
      const statuses = probe.upstream.map((x) => x.response.status).join(',') || 'none';
      return {
        ...base,
        path: idPath,
        expected: `upstream 2xx with ${idPath} = ${show(want)}`,
        actual: statuses,
        message: `write not confirmed by upstream: ${post.probeTool} ${args} got upstream status ${statuses}`,
      };
    }
  }
  for (const e of post.expect) {
    const got = getOne(probe.result.structuredContent, e.probePath);
    const want = getOne(data, e.equalsResultPath);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return {
        ...base,
        path: e.probePath,
        expected: show(want),
        actual: got,
        message: `${post.probeTool} ${args} read back ${e.probePath} = ${show(got)}, write returned ${show(want)}`,
      };
    }
  }
  return null;
}

/** Pure: checks one tool result against its contract. Never throws on odd payloads. */
export function evaluate(contract: ToolContract | undefined, input: EvalInput): EvalResult {
  if (!contract) return { verdict: 'unverifiable', contractId: null, checked: [], violations: [] };
  const empty: EvalResult = { verdict: 'unverifiable', contractId: contract.id, checked: [], violations: [] };
  // An explicit tool error is not a silent failure; the agent already sees it.
  if (input.result.isError) return empty;
  const data = input.result.structuredContent;
  if (!data) {
    // MCP: a tool that declares an outputSchema must return structuredContent.
    if (contract.outputSchema ?? input.declaredOutputSchema) {
      const propertyId = `${contract.id}/outputSchema`;
      return {
        verdict: 'violated',
        contractId: contract.id,
        checked: [propertyId],
        violations: [
          {
            propertyId,
            kind: 'outputSchema',
            path: '$',
            expected: 'structuredContent',
            actual: null,
            message: 'no structured result, though the tool declares an output schema',
          },
        ],
      };
    }
    return empty;
  }

  const checked: string[] = [];
  const violations: Violation[] = [];

  const schema = contract.outputSchema ?? input.declaredOutputSchema;
  if (schema) {
    const propertyId = `${contract.id}/outputSchema`;
    checked.push(propertyId);
    const m = schemaMismatch(schema, data);
    if (m)
      violations.push({
        propertyId,
        kind: 'outputSchema',
        path: '$',
        expected: 'declared outputSchema',
        actual: null,
        message: m,
      });
  }
  for (const inv of contract.invariants) {
    const r = checkInvariant(contract, inv, data, input);
    if (r === 'skip') continue;
    checked.push(`${contract.id}/${inv.id}`);
    if (r) violations.push(r);
  }
  for (const post of contract.postconditions ?? []) {
    checked.push(`${contract.id}/${post.id}`);
    const r = checkReadAfterWrite(contract, post, data, input);
    if (r) violations.push(r);
  }
  const verdict = violations.length ? 'violated' : checked.length ? 'verified' : 'unverifiable';
  return { verdict, contractId: contract.id, checked, violations };
}
