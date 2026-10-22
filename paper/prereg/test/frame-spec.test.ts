import { describe, expect, it } from 'vitest';
import type { FrameSpec } from '../../../packages/interfaces/src/records.ts';
import { checkFrameSpec, loadFrameSpecSchema } from '../lib/frame-spec.ts';
import type { Schema } from '../lib/mini-schema.ts';

// Typed against the interface: a missing or extra field here is a tsc error, so the key sets
// compared below are exactly the interface's keys.
const sample: FrameSpec = {
  domain: ['shop', 'tracker'],
  nF: 4,
  eligibleInputs: ['in1', 'in2'],
  entities: [
    { id: 'ext-a', domain: 'shop', authorBatch: 'shop-b001', eligible: true },
    { id: 'ext-b', domain: 'shop', authorBatch: 'shop-b001', eligible: true },
    { id: 'TRK-X-1', domain: 'tracker', authorBatch: 'tracker-b001', eligible: false },
  ],
  NE: 2,
  attribution: { in1: { 'items[0].price': 'ext-a', 'items[1].price': 'ext-b' }, in2: { price: 'ext-b' } },
  families: { 'items.price.range': 'price', 'price.range': 'price' },
  cells: [
    { contract: 'shop-mcp', property: 'items.price.range', class: 'all', nInputs: 1 },
    { contract: 'shop-mcp', property: 'price.range', class: 'all', nInputs: 1 },
  ],
  K: 2,
  entailedProps: ['items.id.unique'],
  neRule: { topUpBatches: 0, underpowered: true, m: 3 },
  crit: -1,
  power: { pi01: 0, pi005: 0 },
  hash: 'a'.repeat(64),
};

const schema = loadFrameSpecSchema();
const props = (s: Schema) => Object.keys(s.properties as Record<string, unknown>).sort();
const def = (name: string) => (schema.$defs as Record<string, Schema>)[name] as Schema;

describe('frame-spec.schema.json matches the FrameSpec interface', () => {
  it('has exactly the interface keys, all required, no others', () => {
    expect(props(schema)).toEqual(Object.keys(sample).sort());
    expect([...(schema.required as string[])].sort()).toEqual(Object.keys(sample).sort());
    expect(schema.additionalProperties).toBe(false);
  });

  it('nested objects match FrameEntity, FrameCell, NeRule and power', () => {
    expect(props(def('entity'))).toEqual(Object.keys(sample.entities[0] as object).sort());
    expect(props(def('cell'))).toEqual(Object.keys(sample.cells[0] as object).sort());
    expect(props(def('neRule'))).toEqual(Object.keys(sample.neRule).sort());
    const power = (schema.properties as Record<string, Schema>).power as Schema;
    expect(props(power)).toEqual(Object.keys(sample.power).sort());
  });

  it('accepts a valid spec', () => {
    expect(checkFrameSpec(sample)).toEqual([]);
  });

  it('rejects shape and semantic errors', () => {
    const { hash: _drop, ...noHash } = sample;
    expect(checkFrameSpec(noHash).join()).toContain('missing required "hash"');
    expect(checkFrameSpec({ ...sample, extra: 1 }).join()).toContain('unexpected property "extra"');
    expect(checkFrameSpec({ ...sample, hash: 'xyz' }).join()).toContain('does not match');
    expect(checkFrameSpec({ ...sample, NE: 3 }).join()).toContain('entities are eligible');
    expect(checkFrameSpec({ ...sample, K: 5 }).join()).toContain('cells has 2');
    expect(checkFrameSpec({ ...sample, neRule: { ...sample.neRule, m: 4 } }).join()).toContain(
      'requires m = 3',
    );
    expect(checkFrameSpec({ ...sample, crit: 0 }).join()).toContain('crit must be -1');
    expect(checkFrameSpec({ ...sample, attribution: { in1: {} } }).join()).toContain(
      'in2 has no attribution',
    );
  });
});
