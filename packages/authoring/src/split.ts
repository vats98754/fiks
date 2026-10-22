// The seeded dev/test split (PLAN 5.1): stratified by domain x stratum x ideation family, 20% dev
// (24 of 120) plus D1-D5 (always dev); the rest is test. Per-cell dev counts are the floors of
// 0.2 n_cell plus a largest-remainder top-up to round(0.2 N) (ties in seeded order); within a cell
// the ids are seeded-shuffled and the first k are dev. The file has no timestamp: the same input
// and seed give byte-identical output.

import { sha256 } from './export.ts';
import { canonicalJson, seededRng, shuffle } from './rng.ts';

export interface SplitItem {
  id: string;
  domain: string;
  stratum: string;
  ideationFamily: string;
}

export const SEEDED_DEV = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
export const DEV_FRACTION = 0.2;

export interface SplitFile {
  schema: 'fiks-blind-split/1';
  seed: string;
  devFraction: number;
  inputSha256: string;
  seededDev: string[];
  dev: string[];
  test: string[];
  cells: { cell: string; n: number; dev: number }[];
}

export function makeSplit(
  items: readonly SplitItem[],
  seed: string | number,
  devFraction = DEV_FRACTION,
): SplitFile {
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) throw new Error(`duplicate id ${it.id}`);
    if ((SEEDED_DEV as readonly string[]).includes(it.id))
      throw new Error(`${it.id} is a seeded dev drift, not a blind one`);
    ids.add(it.id);
  }
  const sortedItems = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cellKey = (it: SplitItem) => `${it.domain}|${it.stratum}|${it.ideationFamily}`;
  const cells = new Map<string, string[]>();
  for (const it of sortedItems) cells.set(cellKey(it), [...(cells.get(cellKey(it)) ?? []), it.id]);
  const keys = [...cells.keys()].sort();
  const target = Math.round(devFraction * sortedItems.length);
  const exact = keys.map((k) => ({ k, e: devFraction * (cells.get(k) as string[]).length }));
  const counts = new Map(exact.map(({ k, e }) => [k, Math.floor(e)]));
  let left = target - [...counts.values()].reduce((a, b) => a + b, 0);
  const tieOrder = new Map(shuffle(keys, seededRng(seed, 'split:ties')).map((k, i) => [k, i]));
  const byRemainder = [...exact].sort(
    (a, b) =>
      b.e - Math.floor(b.e) - (a.e - Math.floor(a.e)) ||
      (tieOrder.get(a.k) as number) - (tieOrder.get(b.k) as number),
  );
  for (const { k } of byRemainder) {
    if (left <= 0) break;
    const n = (cells.get(k) as string[]).length;
    if ((counts.get(k) as number) < n) {
      counts.set(k, (counts.get(k) as number) + 1);
      left--;
    }
  }
  const dev: string[] = [];
  const test: string[] = [];
  const cellOut: SplitFile['cells'] = [];
  for (const k of keys) {
    const order = shuffle(cells.get(k) as string[], seededRng(seed, `split:${k}`));
    const k2 = counts.get(k) as number;
    dev.push(...order.slice(0, k2));
    test.push(...order.slice(k2));
    cellOut.push({ cell: k, n: order.length, dev: k2 });
  }
  return {
    schema: 'fiks-blind-split/1',
    seed: String(seed),
    devFraction,
    inputSha256: sha256(canonicalJson(sortedItems)),
    seededDev: [...SEEDED_DEV],
    dev: dev.sort(),
    test: test.sort(),
    cells: cellOut,
  };
}

export const splitText = (s: SplitFile) => `${JSON.stringify(s, null, 2)}\n`;
