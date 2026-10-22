// FrameSpec validation: frame-spec.schema.json plus the semantic rules of PLAN 3.1.
import { readFileSync } from 'node:fs';
import { type Schema, validate } from './mini-schema.ts';

export const FRAME_SPEC_SCHEMA_PATH = new URL('../frame-spec.schema.json', import.meta.url);

export function loadFrameSpecSchema(): Schema {
  return JSON.parse(readFileSync(FRAME_SPEC_SCHEMA_PATH, 'utf8')) as Schema;
}

/** The smallest N_E at which the exact test can reject: 0.98^N <= 0.0125 (PLAN 3.1). */
export const NE_MIN_REJECTABLE = 217;

interface FrameSpecLike {
  domain: string[];
  eligibleInputs: string[];
  entities: { id: string; domain: string; eligible: boolean }[];
  NE: number;
  attribution: Record<string, Record<string, string>>;
  cells: unknown[];
  K: number;
  neRule: { m: number };
  crit: number;
}

/** Schema errors, then (if the shape is valid) semantic errors. Empty = valid. */
export function checkFrameSpec(spec: unknown, schema: Schema = loadFrameSpecSchema()): string[] {
  const errors = validate(spec, schema);
  if (errors.length > 0) return errors;
  const s = spec as FrameSpecLike;
  const ids = new Set<string>();
  for (const e of s.entities) {
    if (ids.has(e.id)) errors.push(`entities: duplicate id ${e.id}`);
    ids.add(e.id);
    if (!s.domain.includes(e.domain)) errors.push(`entities: ${e.id} has domain ${e.domain} not in domain[]`);
  }
  const eligible = s.entities.filter((e) => e.eligible).length;
  if (s.NE !== eligible) errors.push(`NE = ${s.NE} but ${eligible} entities are eligible`);
  if (s.K !== s.cells.length) errors.push(`K = ${s.K} but cells has ${s.cells.length} entries`);
  for (const input of s.eligibleInputs) {
    const paths = s.attribution[input];
    if (paths === undefined || Object.keys(paths).length === 0) {
      errors.push(`eligible input ${input} has no attribution`);
    }
  }
  const expectedM = s.NE < NE_MIN_REJECTABLE ? 3 : 4;
  if (s.neRule.m !== expectedM) {
    errors.push(`neRule.m = ${s.neRule.m} but N_E = ${s.NE} requires m = ${expectedM}`);
  }
  if (s.NE < NE_MIN_REJECTABLE && s.crit !== -1) {
    errors.push(`N_E = ${s.NE} < ${NE_MIN_REJECTABLE}: the test cannot reject, so crit must be -1`);
  }
  if (s.NE >= NE_MIN_REJECTABLE && s.crit < 0) errors.push(`N_E = ${s.NE}: crit must be >= 0`);
  return errors;
}
