import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { evaluate } from '../src/index.ts';
import type { ContractFile } from '../src/types.ts';

const root = new URL('../../..', import.meta.url).pathname;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** A two-property contract in Biome's layout. */
const TWO = `{
  "server": "t",
  "version": 1,
  "contracts": [
    {
      "id": "t.get",
      "tool": "get",
      "invariants": [
        { "id": "price.range", "kind": "range", "path": "price", "min": 20, "max": 2000 },
        { "id": "price.notNull", "kind": "notNull", "path": "price" }
      ]
    }
  ]
}
`;

function setup(text = TWO) {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-disable-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, text);
  return { dir, file, log: join(dir, 'logs', 'd11.jsonl') };
}
const disable = (file: string, ids: string, log: string, reason = 'S-dev') =>
  spawnSync(
    'node',
    ['scripts/contract-disable.mjs', '--contracts', file, '--ids', ids, '--reason', reason, '--log', log],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );

/** Paths where two JSON values differ. */
function jsonDiff(a: unknown, b: unknown, path = '$'): string[] {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) =>
    jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`),
  );
}

describe('scripts/contract-disable.mjs', () => {
  test('one id: the JSON diff touches only that property’s disabled and disabledReason; D11 log line', () => {
    const { file, log } = setup();
    const r = disable(file, 't.get/price.range', log);
    expect(r.status, r.stderr).toBe(0);
    const after = readFileSync(file, 'utf8');
    expect(jsonDiff(JSON.parse(TWO), JSON.parse(after))).toEqual([
      '$.contracts.0.invariants.0.disabled',
      '$.contracts.0.invariants.0.disabledReason',
    ]);
    const c = JSON.parse(after) as ContractFile;
    expect(c.contracts[0]?.invariants[0]).toMatchObject({ disabled: true, disabledReason: 'S-dev' });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry).toMatchObject({
      ids: ['t.get/price.range'],
      reason: 'S-dev',
      contractsSha256Before: sha256(TWO),
      contractsSha256After: sha256(after),
    });
    // The evaluator honours it.
    const res = evaluate(c.contracts[0], {
      args: {},
      result: { structuredContent: { price: 5 } },
      now: new Date(),
    });
    expect(res.verdict).toBe('verified');
    expect(res.disabled).toEqual(['t.get/price.range']);
  });

  test('an unknown id exits 2 and leaves the file byte-unchanged (no log line)', () => {
    const { file, log } = setup();
    const r = disable(file, 't.get/price.range,t.get/nope', log);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown property ids: t\.get\/nope/);
    expect(readFileSync(file, 'utf8')).toBe(TWO);
    expect(existsSync(log)).toBe(false);
  });

  test('already disabled, missing arguments: exit 2, unchanged', () => {
    const { file, log } = setup();
    expect(disable(file, 't.get/price.notNull', log).status).toBe(0);
    const once = readFileSync(file, 'utf8');
    expect(disable(file, 't.get/price.notNull', log).status).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe(once);
    const r = spawnSync('node', ['scripts/contract-disable.mjs', '--contracts', file], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe(once);
  });

  test('shop contracts: a postcondition and an invariant; nothing else moves', () => {
    const shop = readFileSync(join(root, 'packages/contracts/contracts/shop-mcp.contracts.json'), 'utf8');
    const { file, log } = setup(shop);
    const r = disable(
      file,
      'shop.get_order/total.range,shop.create_order/readAfterWrite',
      log,
      'S-dev: test',
    );
    expect(r.status, r.stderr).toBe(0);
    expect(jsonDiff(JSON.parse(shop), JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual([
      '$.contracts.2.postconditions.0.disabled',
      '$.contracts.2.postconditions.0.disabledReason',
      '$.contracts.3.invariants.2.disabled',
      '$.contracts.3.invariants.2.disabledReason',
    ]);
  });
});
