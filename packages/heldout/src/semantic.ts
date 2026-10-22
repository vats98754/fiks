// Semantic equality of tool outputs (PLAN 3.0, held-out criterion 2 and 5):
//   - integers exact; floats |a-b| <= 1e-9 * max(1, |a|, |b|);
//   - null == absent; key order ignored;
//   - arrays ordered unless the domain schema marks the path unordered;
//   - strings NFC-exact; timestamps (ISO-8601 instants on both sides) compared as instants;
//   - for inputs that truth() marks invalid, an error == an empty result.
// Pure functions, no I/O. Shared by the grader (host side) and the in-sandbox observation step.

export interface SemanticOptions {
  /**
   * Paths whose arrays compare as multisets, in the `items` / `items[*].tags` form (array indices
   * written as `[*]`). Everything else is ordered.
   */
  unorderedPaths?: readonly string[];
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** An ISO-8601 date-time with an explicit offset (an instant, not a local time). */
export function isInstantString(v: unknown): v is string {
  return typeof v === 'string' && ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v));
}

const absent = (v: unknown) => v === undefined || v === null;

export function sameNumber(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** `items[3].price` -> `items[*].price` (the form unorderedPaths uses). */
export const genericPath = (path: string) => path.replace(/\[\d+\]/g, '[*]');

/**
 * Paths where `b` differs from `a` under PLAN 3.0's semantic equality (empty = equal). The first
 * argument's role is "expected" only for the path labels; the relation is symmetric.
 */
export function semanticDiff(a: unknown, b: unknown, opts: SemanticOptions = {}, path = ''): string[] {
  if (absent(a) && absent(b)) return [];
  if (absent(a) || absent(b)) return [path];
  if (typeof a === 'number' && typeof b === 'number') return sameNumber(a, b) ? [] : [path];
  if (typeof a === 'string' && typeof b === 'string') {
    if (isInstantString(a) && isInstantString(b)) return Date.parse(a) === Date.parse(b) ? [] : [path];
    return a.normalize('NFC') === b.normalize('NFC') ? [] : [path];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [path];
    if (opts.unorderedPaths?.includes(genericPath(path)))
      return multisetEqual(a, b, opts, path) ? [] : [path];
    return a.flatMap((x, i) => semanticDiff(x, b[i], opts, `${path}[${i}]`));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => semanticDiff(a[k], b[k], opts, path ? `${path}.${k}` : k));
  }
  return Object.is(a, b) ? [] : [path];
}

export function semanticEqual(a: unknown, b: unknown, opts: SemanticOptions = {}): boolean {
  return semanticDiff(a, b, opts).length === 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function multisetEqual(a: unknown[], b: unknown[], opts: SemanticOptions, path: string): boolean {
  const used = new Set<number>();
  return a.every((x) => {
    const j = b.findIndex((y, k) => !used.has(k) && semanticDiff(x, y, opts, `${path}[*]`).length === 0);
    if (j === -1) return false;
    used.add(j);
    return true;
  });
}

// --- Tool outputs ----------------------------------------------------------------------------

/** A tool result classified for comparison. */
export type OutputKind = { kind: 'error' } | { kind: 'empty' } | { kind: 'data'; value: unknown };

/**
 * A tool result (`{isError, structuredContent, content}`) or a bare structured output. An error
 * result is `error`; a result with no structured content (or an explicit null) is `empty`.
 */
export function classifyOutput(output: unknown): OutputKind {
  if (absent(output)) return { kind: 'empty' };
  if (isPlainObject(output)) {
    if (output.isError === true) return { kind: 'error' };
    if ('structuredContent' in output || 'content' in output) {
      return absent(output.structuredContent)
        ? { kind: 'empty' }
        : { kind: 'data', value: output.structuredContent };
    }
  }
  return { kind: 'data', value: output };
}

/**
 * Two tool outputs for the same input. Errors equal errors (messages are free text). For an input
 * that truth() marks invalid, error == empty (and data still compares as data).
 */
export function outputsEquivalent(
  a: unknown,
  b: unknown,
  opts: SemanticOptions & { inputValid?: boolean } = {},
): boolean {
  const x = classifyOutput(a);
  const y = classifyOutput(b);
  const noData = (k: OutputKind) => k.kind !== 'data';
  if (opts.inputValid === false && noData(x) && noData(y)) return true;
  if (x.kind !== y.kind) return false;
  if (x.kind === 'data' && y.kind === 'data') return semanticEqual(x.value, y.value, opts);
  return true;
}

/**
 * A tool output against truth()'s expected value: valid input -> data semantically equal to
 * `expected`; invalid input -> an error or an empty result.
 */
export function matchesTruth(
  output: unknown,
  truth: { inputValid: boolean; expected: unknown },
  opts: SemanticOptions = {},
): boolean {
  const k = classifyOutput(output);
  if (!truth.inputValid) return k.kind !== 'data';
  return k.kind === 'data' && semanticEqual(truth.expected, k.value, opts);
}
