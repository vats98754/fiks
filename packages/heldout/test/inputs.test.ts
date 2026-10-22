// Differential inputs (PLAN 3.0 criterion 2): 200 fast-check inputs per drift under a fixed seed,
// identical across draws and processes; DOM2's generate(seed, n) modules are supported.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DIFFERENTIAL_RUNS,
  DIFFERENTIAL_SEED,
  drawInputs,
  FAST_CHECK_VERSION,
  inputsHash,
  resolveArgs,
} from '../src/inputs.ts';
import { loadPackage } from '../src/pkg.ts';
import { FIKS_ROOT, manifestOf } from './support/shop.ts';

const IDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'DEV-X1', 'TRK-DEV-1'];

describe('drawInputs', () => {
  test('fast-check is the pinned 4.10.2', () => {
    expect(FAST_CHECK_VERSION).toBe('4.10.2');
  });

  for (const id of IDS) {
    test(`${id}: ${DIFFERENTIAL_RUNS} inputs, same seed -> same inputs`, async () => {
      const p = await loadPackage(manifestOf(id));
      const a = await drawInputs(p.generators);
      const b = await drawInputs(p.generators);
      expect(a).toHaveLength(DIFFERENTIAL_RUNS);
      expect(inputsHash(b)).toBe(inputsHash(a));
      expect(inputsHash(await drawInputs(p.generators, { seed: DIFFERENTIAL_SEED + 1 }))).not.toBe(
        inputsHash(a),
      );
      for (const x of a) {
        expect(x.calls.length).toBeGreaterThan(0);
        for (const c of x.calls) expect(typeof c.tool).toBe('string');
      }
    });
  }

  test('identical in a separate process (no hidden state)', async () => {
    const p = await loadPackage(manifestOf('D3'));
    const here = inputsHash(await drawInputs(p.generators));
    const script = `import { drawInputs, inputsHash } from './packages/heldout/src/inputs.ts';
import { loadPackage } from './packages/heldout/src/pkg.ts';
const p = await loadPackage(${JSON.stringify(manifestOf('D3'))});
console.log(inputsHash(await drawInputs(p.generators)));`;
    const out = execFileSync(
      join(FIKS_ROOT, 'node_modules/.bin/tsx'),
      ['--input-type=module', '-e', script],
      {
        cwd: FIKS_ROOT,
        encoding: 'utf8',
      },
    );
    expect(out.trim()).toBe(here);
  }, 60_000);

  test('$ref arguments take a field of an earlier call output', () => {
    const outs = [{ structuredContent: { order_id: 'o-5002' } }];
    expect(resolveArgs({ order_id: { $ref: { call: 0, field: 'order_id' } }, x: 1 }, outs)).toEqual({
      order_id: 'o-5002',
      x: 1,
    });
    expect(resolveArgs({ order_id: { $ref: { call: 0, field: 'order_id' } } }, [{ isError: true }])).toEqual({
      order_id: null,
    });
  });
});
