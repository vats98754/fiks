// B-SNAP (PLAN 6.1): snapshot / recorded-response diff, reimplementing Gilesi-style and Hoverfly
// diff behaviour [monce2025gilesi] [hoverfly-modes]. Each call is compared with the v1 recording of
// the same request (tool + canonical args); a request never recorded on v1 is compared with the
// tool-level profile of every v1 recording of that tool. Compared aspects, never raw values:
//   fieldSet   normalised paths (`items[*].price`) added or removed;
//   type       JSON type at a path not seen there on v1;
//   magnitude  floor(log10|x|) bucket of a number differs (same request: per concrete location;
//              tool profile: outside the v1 [min, max] bucket range of that path);
//   length     an array's length vs its sibling `total`, and vs the recorded length;
//   isError    the result's error flag differs.

import type { Violation } from '@fiks/contracts';
import type { CallRecord, MonitorInput, MonitorResult } from '@fiks/interfaces';
import type { SyncBaselineMonitor } from './types.ts';
import { callKey, getOrInit, type JsonType, magnitudeBucket, resultData, walk } from './util.ts';

export const B_SNAP_ID = 'B-SNAP';

interface Shape {
  isError: boolean;
  /** normalised path -> JSON types seen there. */
  types: Map<string, Set<JsonType>>;
  /** concrete location -> magnitude bucket (numbers only). */
  buckets: Map<string, number | 'zero' | 'nonfinite'>;
  /** concrete array location -> {length, total (sibling `total`, if a number)}. */
  arrays: Map<string, { length: number; total: number | null }>;
}

function shapeOf(result: MonitorInput['result']): Shape {
  const data = resultData(result);
  const shape: Shape = {
    isError: result.isError === true,
    types: new Map(),
    buckets: new Map(),
    arrays: new Map(),
  };
  const leaves = walk(data);
  const valueAt = new Map(leaves.map((l) => [l.at, l.value]));
  for (const leaf of leaves) {
    getOrInit(shape.types, leaf.path, () => new Set()).add(leaf.type);
    if (leaf.type === 'number') shape.buckets.set(leaf.at, magnitudeBucket(leaf.value as number));
    if (leaf.type === 'array')
      shape.arrays.set(leaf.at, { length: (leaf.value as unknown[]).length, total: null });
  }
  for (const [at, a] of shape.arrays) {
    if (at === '$') continue;
    const dot = at.lastIndexOf('.');
    const parent = dot === -1 ? data : valueAt.get(at.slice(0, dot));
    const total =
      parent !== null && typeof parent === 'object' ? (parent as Record<string, unknown>).total : undefined;
    a.total = typeof total === 'number' ? total : null;
  }
  return shape;
}

/** normalised path of a concrete location: `items[3].price` -> `items[*].price`. */
const norm = (at: string) => at.replace(/\[\d+\]/g, '[*]');

interface ToolProfile {
  n: number;
  /** path -> types seen across all v1 recordings. */
  types: Map<string, Set<JsonType>>;
  /** path -> number of v1 recordings that contain it. */
  presence: Map<string, number>;
  /** normalised path -> [min, max] numeric bucket. */
  bucketRange: Map<string, [number, number]>;
  /** normalised array path -> true if every v1 recording had length == total. */
  lengthMatchesTotal: Map<string, boolean>;
  isError: Set<boolean>;
}

export interface Snapshot {
  byCall: Map<string, Shape>;
  byTool: Map<string, ToolProfile>;
}

/** Builds the v1 snapshot store from v1 CallRecords (first recording of each request wins). */
export function buildSnapshot(v1: CallRecord[]): Snapshot {
  const snap: Snapshot = { byCall: new Map(), byTool: new Map() };
  for (const rec of v1) {
    const shape = shapeOf(rec.output);
    const key = callKey(rec.tool, rec.args);
    if (!snap.byCall.has(key)) snap.byCall.set(key, shape);
    let p = snap.byTool.get(rec.tool);
    if (!p) {
      p = {
        n: 0,
        types: new Map(),
        presence: new Map(),
        bucketRange: new Map(),
        lengthMatchesTotal: new Map(),
        isError: new Set(),
      };
      snap.byTool.set(rec.tool, p);
    }
    p.n++;
    p.isError.add(shape.isError);
    for (const [path, ts] of shape.types) {
      const set = getOrInit(p.types, path, () => new Set<JsonType>());
      for (const t of ts) set.add(t);
      p.presence.set(path, (p.presence.get(path) ?? 0) + 1);
    }
    for (const [at, b] of shape.buckets) {
      if (typeof b !== 'number') continue;
      const path = norm(at);
      const r = p.bucketRange.get(path);
      p.bucketRange.set(path, r ? [Math.min(r[0], b), Math.max(r[1], b)] : [b, b]);
    }
    for (const [at, a] of shape.arrays) {
      if (a.total === null) continue;
      const path = norm(at);
      p.lengthMatchesTotal.set(path, (p.lengthMatchesTotal.get(path) ?? true) && a.length === a.total);
    }
  }
  return snap;
}

function diff(kind: string, path: string, expected: string, actual: unknown, message: string): Violation {
  return { propertyId: `${B_SNAP_ID}/${kind}`, kind, path, expected, actual, message };
}

/** Differences between a call's shape and the v1 recording of the same request. */
function diffExact(now: Shape, v1: Shape): Violation[] {
  const out: Violation[] = [];
  if (now.isError !== v1.isError)
    out.push(
      diff('isError', '$', String(v1.isError), now.isError, `isError ${v1.isError} -> ${now.isError}`),
    );
  for (const path of v1.types.keys())
    if (!now.types.has(path)) out.push(diff('fieldSet', path, 'present', null, `${path} removed`));
  for (const [path, ts] of now.types) {
    const was = v1.types.get(path);
    if (!was) {
      out.push(diff('fieldSet', path, 'absent', [...ts].join('|'), `${path} added`));
      continue;
    }
    const added = [...ts].filter((t) => !was.has(t));
    if (added.length)
      out.push(
        diff(
          'type',
          path,
          [...was].join('|'),
          added.join('|'),
          `${path} type ${[...was].join('|')} -> ${added.join('|')}`,
        ),
      );
  }
  for (const [at, b] of now.buckets) {
    const was = v1.buckets.get(at);
    if (was !== undefined && was !== b)
      out.push(diff('magnitude', at, `10^${was}`, `10^${b}`, `${at} magnitude 10^${was} -> 10^${b}`));
  }
  for (const [at, a] of now.arrays) {
    const was = v1.arrays.get(at);
    if (!was) continue;
    if (
      a.length !== was.length ||
      (a.total !== null && was.total !== null && (a.length === a.total) !== (was.length === was.total))
    )
      out.push(
        diff(
          'length',
          at,
          `length ${was.length} of total ${was.total}`,
          a.length,
          `${at} length ${was.length}/${was.total} -> ${a.length}/${a.total}`,
        ),
      );
  }
  return out;
}

/** Differences between a call's shape and the tool-level v1 profile (request never recorded). */
function diffProfile(now: Shape, p: ToolProfile): Violation[] {
  const out: Violation[] = [];
  if (!p.isError.has(now.isError))
    out.push(
      diff('isError', '$', [...p.isError].join('|'), now.isError, `isError ${now.isError} never seen on v1`),
    );
  // A path every v1 recording had is missing (an error result is reported as isError instead).
  if (!now.isError)
    for (const [path, count] of p.presence)
      if (count === p.n && !now.types.has(path))
        out.push(diff('fieldSet', path, 'present', null, `${path} removed`));
  for (const [path, ts] of now.types) {
    const was = p.types.get(path);
    if (!was) {
      out.push(diff('fieldSet', path, 'absent', [...ts].join('|'), `${path} added`));
      continue;
    }
    const added = [...ts].filter((t) => !was.has(t));
    if (added.length)
      out.push(
        diff(
          'type',
          path,
          [...was].join('|'),
          added.join('|'),
          `${path} type ${[...was].join('|')} -> ${added.join('|')}`,
        ),
      );
  }
  for (const [at, b] of now.buckets) {
    const r = p.bucketRange.get(norm(at));
    if (!r || typeof b !== 'number') continue;
    if (b < r[0] || b > r[1])
      out.push(
        diff(
          'magnitude',
          at,
          `10^${r[0]}..10^${r[1]}`,
          `10^${b}`,
          `${at} magnitude 10^${b} outside v1 10^${r[0]}..10^${r[1]}`,
        ),
      );
  }
  for (const [at, a] of now.arrays) {
    if (a.total === null || p.lengthMatchesTotal.get(norm(at)) !== true) continue;
    if (a.length !== a.total)
      out.push(
        diff('length', at, `length == total`, a.length, `${at} length ${a.length} != total ${a.total}`),
      );
  }
  return out;
}

/** B-SNAP monitor over a v1 snapshot. `unverifiable` for a tool with no v1 recording. */
export function createSnapMonitor(snapshot: Snapshot): SyncBaselineMonitor {
  const monitor = (input: MonitorInput): MonitorResult => {
    const exact = snapshot.byCall.get(callKey(input.tool, input.args));
    const profile = snapshot.byTool.get(input.tool);
    if (!exact && !profile) return { verdict: 'unverifiable', checked: [], violations: [], disabled: [] };
    const now = shapeOf(input.result);
    const violations = exact ? diffExact(now, exact) : diffProfile(now, profile as ToolProfile);
    const checked = [`${B_SNAP_ID}/${exact ? 'sameRequest' : 'toolProfile'}`];
    return { verdict: violations.length ? 'violated' : 'verified', checked, violations, disabled: [] };
  };
  return Object.assign(monitor, { id: B_SNAP_ID });
}
