// Walks a JSON value and lists every slot (a value at a concrete path) with what an operator needs
// to change it in place: the parent container and the key or index under it.
import { isRecord } from './util.ts';

export interface Slot {
  /** Concrete path segments from the root; [] is the root. */
  path: (string | number)[];
  /** Normalized path: array indices as `[*]`, e.g. `items[*].price`; the root is `$`. */
  norm: string;
  value: unknown;
  /** The object or array holding this slot; null for the root. */
  parent: Record<string, unknown> | unknown[] | null;
  /** Object key (string) or array index (number) under `parent`; null for the root. */
  at: string | number | null;
  /** Whether some ancestor of this slot is an array element. */
  inArray: boolean;
}

export function normPath(path: readonly (string | number)[]): string {
  let s = '';
  for (const seg of path) s += typeof seg === 'number' ? '[*]' : s === '' ? seg : `.${seg}`;
  return s === '' ? '$' : s;
}

/** Every slot of `root` in document order (pre-order, object keys in insertion order). */
export function slots(root: unknown): Slot[] {
  const out: Slot[] = [];
  const visit = (
    value: unknown,
    path: (string | number)[],
    parent: Slot['parent'],
    at: Slot['at'],
    inArray: boolean,
  ) => {
    out.push({ path, norm: normPath(path), value, parent, at, inArray });
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        visit(v, [...path, i], value, i, true);
      });
    } else if (isRecord(value)) {
      for (const k of Object.keys(value)) visit(value[k], [...path, k], value, k, inArray);
    }
  };
  visit(root, [], null, null, false);
  return out;
}

/** The slots grouped by normalized path, groups sorted by path (code-unit order). */
export function groupByNorm(list: readonly Slot[]): [string, Slot[]][] {
  const m = new Map<string, Slot[]>();
  for (const s of list) {
    const g = m.get(s.norm);
    if (g) g.push(s);
    else m.set(s.norm, [s]);
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Writes `value` into the slot's parent. The root cannot be set this way. */
export function setSlot(s: Slot, value: unknown): void {
  if (s.parent === null || s.at === null) throw new Error('setSlot: cannot replace the root in place');
  (s.parent as Record<string | number, unknown>)[s.at] = value;
}

/** Renames an object property in place, keeping its position among the keys. */
export function renameKey(obj: Record<string, unknown>, from: string, to: string): void {
  const entries = Object.entries(obj);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k === from ? to : k] = v;
}
