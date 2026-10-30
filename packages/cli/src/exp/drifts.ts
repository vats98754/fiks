// The committed pilot traces (one per drift) that every exp run starts from.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadTrace, type Trace } from '@fiks/repro';
import { ROOT } from '../paths.ts';
import { DRIFTS, type ExpDrift } from './types.ts';

export const PILOT_TRACE_DIR = join(ROOT, 'packages/contract-update/test/fixtures/traces');
/** Test-only oracle fixes (positive control). */
export const ORACLE_DIR = join(ROOT, 'packages/cli/test/oracles');

export function isDrift(x: string): x is ExpDrift {
  return (DRIFTS as readonly string[]).includes(x);
}

export interface PilotTrace {
  file: string;
  /** Repo-relative path (what records store). */
  rel: string;
  sha256: string;
  trace: Trace;
}

export function pilotTrace(drift: ExpDrift, dir = PILOT_TRACE_DIR): PilotTrace {
  const hits = readdirSync(dir).filter((f) => f.startsWith(`${drift}-`) && f.endsWith('.json'));
  if (hits.length !== 1)
    throw new Error(`expected one pilot trace for ${drift} in ${dir}, found ${hits.length}`);
  const file = join(dir, hits[0] as string);
  const bytes = readFileSync(file);
  return {
    file,
    rel: relative(ROOT, file),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    trace: loadTrace(file),
  };
}

export const oraclePatch = (drift: ExpDrift) => join(ORACLE_DIR, `${drift}.patch`);
