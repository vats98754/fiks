// Path resolution over a tool output (PLAN 3.1 "FP-eligible input: path resolution only"). The
// same path grammar as the contracts (`a.b`, `items[*].price`), written here so the frame code
// never imports the evaluator.

export interface Resolved {
  /** Concrete location, e.g. `items[2].price` (`''` for the root). */
  at: string;
  value: unknown;
}

/** Every value at `path` with its concrete location; missing keys resolve to `undefined`. */
export function resolvePath(root: unknown, path: string): Resolved[] {
  let cur: Resolved[] = [{ at: '', value: root }];
  for (const seg of path.split('.')) {
    const wild = seg.endsWith('[*]');
    const key = wild ? seg.slice(0, -3) : seg;
    const next: Resolved[] = [];
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

/** The values at `path` that are present (not undefined). */
export const presentAt = (root: unknown, path: string): Resolved[] =>
  resolvePath(root, path).filter((r) => r.value !== undefined);

/** `items[*].price` for `items[2].price`. */
export const wildcard = (at: string): string => at.replace(/\[\d+\]/g, '[*]');
