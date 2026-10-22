// Per-element H1 (round 7; DET with MON and AN): one search input whose page holds two
// out-of-range extended items (ext-a $9, ext-c $5000) and one in-range item (ext-b $50).
// frame-k attributes items[i].price to each element's own entity; MON `replay-cli --per-element`
// writes two items.price.range rows; h1_precision.py gives Z = 1 for ext-a and ext-c, Z = 0 for
// ext-b and exactly one input-level FP; first-element-only rows exit 2.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameSpec } from '@fiks/interfaces';
import { beforeAll, expect, test } from 'vitest';
import { checkFrameSpec } from '../../../paper/prereg/lib/frame-spec.ts';
import { toJsonl } from '../src/index.ts';
import { fiksOk, PY, ROOT, readJson, readLines, run, TSX, tmp } from './support/cli.ts';

const REPLAY_CLI = join(ROOT, 'packages/proxy/src/replay-cli.ts');
const H1 = join(ROOT, 'paper/scripts/h1_precision.py');
const RANGE = 'shop.search_products/items.price.range';

let dir: string;
let env: Record<string, string>;

beforeAll(() => {
  dir = tmp('per-element');
  const item = (id: string, name: string, price: number, authorBatch: string) => ({
    id,
    name,
    category: 'gadget',
    price,
    currency: 'USD',
    stock: 3,
    authorBatch,
  });
  writeFileSync(
    join(dir, 'ext.json'),
    JSON.stringify({
      entities: [
        item('px-ext-a', 'Zephyr Gadget A', 9, 'b01'),
        item('px-ext-b', 'Zephyr Gadget B', 50, 'b01'),
        item('px-ext-c', 'Zephyr Gadget C', 5000, 'b02'),
      ],
    }),
  );
  env = { VENDOR_EXTENDED_CATALOG: join(dir, 'ext.json') };
  writeFileSync(
    join(dir, 'enum.jsonl'),
    toJsonl([
      {
        domain: 'shop',
        stratum: 'S-grid',
        tool: 'search_products',
        args: { query: 'zephyr' },
        dedupeKey: 'q-zephyr',
      },
    ]),
  );
  fiksOk(
    [
      'record',
      '--domain',
      'shop',
      '--frame',
      '--monitor',
      'none',
      '--in',
      join(dir, 'enum.jsonl'),
      '--out',
      join(dir, 'frame'),
    ],
    env,
  );
  fiksOk(['frame-k', '--records', join(dir, 'frame'), '--out', join(dir, 'spec.json')], env);
});

test('frame-k attributes each element path to its own entity', () => {
  const spec = readJson<FrameSpec>(join(dir, 'spec.json'));
  expect(checkFrameSpec(spec)).toEqual([]);
  expect(spec.eligibleInputs).toEqual(['q-zephyr']);
  expect(spec.attribution['q-zephyr']).toEqual({
    'items[0].price': 'px-ext-a',
    'items[1].price': 'px-ext-b',
    'items[2].price': 'px-ext-c',
  });
  expect(spec.entities.map((e) => [e.id, e.eligible])).toEqual([
    ['px-ext-a', true],
    ['px-ext-b', true],
    ['px-ext-c', true],
  ]);
  expect(spec.NE).toBe(3);
});

test('replay-cli --per-element -> h1_precision.py: Z = 1 for ext-a and ext-c, 0 for ext-b, one input-level FP', () => {
  const rows = join(dir, 'rows.jsonl');
  const r = run(TSX, [REPLAY_CLI, '--in', join(dir, 'frame/calls.jsonl'), '--out', rows, '--per-element']);
  expect(r.code, r.stderr).toBe(0);
  const violated = readLines<{ verdict: string; property: string; at: string; originUnit: string }>(
    rows,
  ).filter((x) => x.verdict === 'violated');
  expect(violated.map((x) => [x.property, x.at, x.originUnit])).toEqual([
    [RANGE, 'items[0].price', 'px-ext-a'],
    [RANGE, 'items[2].price', 'px-ext-c'],
  ]);
  expect(
    existsSync(PY),
    `${PY} (python3.12 -m venv paper/.venv && paper/.venv/bin/pip install -r paper/scripts/requirements.txt)`,
  ).toBe(true);
  const out = join(dir, 'h1.json');
  const h1 = run(PY, [H1, '--rows', rows, '--frame-spec', join(dir, 'spec.json'), '--out', out]);
  expect(h1.code, h1.stderr).toBe(0);
  const res = readJson<{
    Z: Record<string, number>;
    X: number;
    D12: { fpInputs: number; fpElements: number };
  }>(out);
  expect(res.Z).toEqual({ 'px-ext-a': 1, 'px-ext-b': 0, 'px-ext-c': 1 });
  expect(res.X).toBe(2);
  expect(res.D12.fpInputs).toBe(1);
  expect(res.D12.fpElements).toBe(2);

  // The same pipeline on first-element-only (receipt-level) rows is refused.
  const first = join(dir, 'rows-first.jsonl');
  expect(run(TSX, [REPLAY_CLI, '--in', join(dir, 'frame/calls.jsonl'), '--out', first]).code).toBe(0);
  const refused = run(PY, [H1, '--rows', first, '--frame-spec', join(dir, 'spec.json')]);
  expect(refused.code).toBe(2);
  expect(refused.stderr + refused.stdout).toContain('per-element rows required');
});
