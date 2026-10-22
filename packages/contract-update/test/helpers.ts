// Test inputs. Recorded data is copied verbatim (then biome-formatted) from the shop-mcp repo:
//   fixtures/shop-v1/*.json  <- .work/shop-mcp/test/fixtures/v1/ (the clean v1 corpus)
//   fixtures/traces/*.json   <- .work/shop-mcp/test/repro/tr_*.json (the stored D1-D5 traces)
//   fixtures/shop-tools-list.json <- the `tools/list` result of shop-mcp at tag seed-v1
//     (9313c40354ad249f96206c40f80dc8d6bbcc2540), run over stdio; the declared outputSchemas the
//     live proxy checks. Tool outputSchemas are unchanged between seed-v1 and the fixed heads.
// Benign triggers and mutation variants are SYNTHESIZED here from those recordings: the benign
// author (5.3) and MUT (5.4) streams are not merged yet. Each variant applies one 5.4 operator to
// the upstream body and mirrors the v1 server's pass-through of that field into the tool output.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Recording } from '@fiks/contracts';
import {
  type DeclaredOutputSchemas,
  declaredOutputSchemas,
  fromRecording,
  type GateCase,
} from '../src/cases.ts';

const dir = join(import.meta.dirname, 'fixtures');

export function load(rel: string): Recording {
  return JSON.parse(readFileSync(join(dir, rel), 'utf8')) as Recording;
}

export const cleanCorpus = (): Recording[] =>
  readdirSync(join(dir, 'shop-v1'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => load(`shop-v1/${f}`));

export const storedTraces = (): Recording[] =>
  readdirSync(join(dir, 'traces'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => load(`traces/${f}`));

/** shop-mcp's declared outputSchemas, by tool name, from its recorded tools/list. */
export const shopOutputSchemas = (): DeclaredOutputSchemas =>
  declaredOutputSchemas(
    (JSON.parse(readFileSync(join(dir, 'shop-tools-list.json'), 'utf8')) as { tools: { name: string }[] })
      .tools,
  );

export const D1 = () => load('traces/D1-tr_b47c5b77c6.json');

type Obj = Record<string, unknown>;

/**
 * Rewrites a recording's first upstream body and its tool output with the same edit, keeping the
 * text content block in sync with structuredContent (as the v1 server does).
 */
export function edit(rec: Recording, id: string, fn: (body: Obj, out: Obj) => void): Recording {
  const r = structuredClone(rec);
  r.id = id;
  const ex = r.http[0];
  if (!ex || !r.result?.structuredContent) throw new Error(`${rec.id}: nothing to edit`);
  const body = JSON.parse(ex.response.body) as Obj;
  const out = r.result.structuredContent;
  fn(body, out);
  ex.response.body = JSON.stringify(body);
  r.result.content = [{ type: 'text', text: JSON.stringify(out) }];
  delete r.violated;
  delete r.target;
  return r;
}

/** A mutation variant as a GateCase labelled with its operator. */
export const variant = (trigger: Recording, m: string, fn: (body: Obj, out: Obj) => void): GateCase => ({
  ...fromRecording(edit(trigger, `${trigger.id}~${m}`, fn)),
  mutant: m,
});

const items = (o: Obj) => o.items as Obj[];

/** Benign 5.3 "widened legitimate range": a premium laptop at $2,500 joins the laptop search. */
export function premiumSearch(): Recording {
  const premium = { id: 'p-1009', name: 'Titan 18 Pro Laptop', category: 'laptop', currency: 'USD' };
  return edit(load('shop-v1/search-laptop.json'), 'benign-premium-search', (body, out) => {
    items(body).push({ ...premium, stock: 2, price: 2500 });
    body.total = items(body).length;
    items(out).push({ ...premium, price: 2500 });
    out.count = items(out).length;
    out.total = items(out).length;
  });
}

/** Benign 5.3: known-good product p-1004 is re-priced as a premium model at $2,499. */
export function premiumProduct(): Recording {
  return edit(load('shop-v1/product-p-1004.json'), 'benign-premium-p-1004', (body, out) => {
    body.price = 2499;
    out.price = 2499;
  });
}

const setPrices = (list: Obj[], f: (p: unknown) => unknown) => {
  for (const it of list) it.price = f(it.price);
};

/** 5.4 operators on the premium search trigger (price field and the items array). */
export function searchVariants(trigger = premiumSearch()): GateCase[] {
  const mk = (m: string, fn: (b: Obj, o: Obj) => void) => variant(trigger, m, fn);
  return [
    mk('M1', (b, o) => {
      setPrices(items(b), (p) => (p as number) * 100);
      setPrices(items(o), (p) => (p as number) * 100);
    }),
    mk('M2', (b, o) => {
      setPrices(items(b), (p) => (p as number) / 100);
      setPrices(items(o), (p) => (p as number) / 100);
    }),
    mk('M5', (b, o) => {
      setPrices(items(b), () => null);
      setPrices(items(o), () => null);
    }),
    mk('M6', (b, o) => {
      // Truncate keeping `total`; with five items, truncate to 3 so the operator has an effect.
      b.items = items(b).slice(0, 3);
      o.items = items(o).slice(0, 3);
      o.count = 3;
    }),
  ];
}

/** 5.4 operators on the premium product trigger's `price`. */
export function productVariants(trigger = premiumProduct()): GateCase[] {
  const mk = (m: string, f: (p: unknown) => unknown) =>
    variant(trigger, m, (b, o) => {
      b.price = f(b.price);
      o.price = f(o.price);
    });
  return [
    mk('M1', (p) => (p as number) * 100),
    mk('M2', (p) => (p as number) / 100),
    mk('M5', () => null),
    mk('M7', (p) => String(p)),
  ];
}
