// B-TRIG (PLAN 6.1): the triggers a conventional pipeline already has. Per call: the tool returned
// `isError`, or the recorder logged an exception for the call. Per drift (facts passed in, the same
// for every call of that drift): the pinned oasdiff found any change between the v1 and drifted
// vendor specs, or `pnpm typecheck` fails on the server. A silent drift fires none of these by
// construction (PLAN 4, D2) [oasdiff-breaking].
import { spawnSync } from 'node:child_process';
import type { Violation } from '@fiks/contracts';
import type { MonitorInput, MonitorResult } from '@fiks/interfaces';
import type { SyncBaselineMonitor } from './types.ts';

export const B_TRIG_ID = 'B-TRIG';

export interface TrigFacts {
  /** oasdiff findings between the v1 and the drifted vendor spec (see oasdiff.ts). */
  specDiff?: { findings: number };
  /** Result of the server's typecheck under the drift (see runTypecheck). */
  typecheck?: { ok: boolean };
}

/** An event the recorder logs when the call threw instead of returning a result. */
const isException = (e: Record<string, unknown>) => e.type === 'exception' || e.type === 'error';

function fire(kind: string, expected: string, actual: unknown, message: string): Violation {
  return { propertyId: `${B_TRIG_ID}/${kind}`, kind, path: '$', expected, actual, message };
}

/**
 * B-TRIG monitor. `events` are read from `input` when it carries them (CallRecord events passed as
 * `(input as {events}).events` by the detector runner).
 */
export function createTrigMonitor(facts: TrigFacts = {}): SyncBaselineMonitor {
  const monitor = (input: MonitorInput & { events?: Record<string, unknown>[] }): MonitorResult => {
    const checked = [`${B_TRIG_ID}/isError`, `${B_TRIG_ID}/exception`];
    const violations: Violation[] = [];
    if (input.result.isError === true)
      violations.push(fire('isError', 'isError false', true, 'the tool returned isError'));
    const ex = (input.events ?? []).find(isException);
    if (ex)
      violations.push(
        fire('exception', 'no exception', ex.message ?? ex.type, 'the call raised an exception'),
      );
    if (facts.specDiff) {
      checked.push(`${B_TRIG_ID}/specDiff`);
      if (facts.specDiff.findings > 0)
        violations.push(
          fire(
            'specDiff',
            '0 oasdiff findings',
            facts.specDiff.findings,
            `oasdiff reports ${facts.specDiff.findings} spec changes`,
          ),
        );
    }
    if (facts.typecheck) {
      checked.push(`${B_TRIG_ID}/typecheck`);
      if (!facts.typecheck.ok)
        violations.push(fire('typecheck', 'typecheck passes', false, 'typecheck fails'));
    }
    return { verdict: violations.length ? 'violated' : 'verified', checked, violations, disabled: [] };
  };
  return Object.assign(monitor, { id: B_TRIG_ID });
}

/** Runs the server's typecheck (default `pnpm typecheck`) in `dir`; ok iff exit code 0. */
export function runTypecheck(
  dir: string,
  cmd: [string, ...string[]] = ['pnpm', 'typecheck'],
): { ok: boolean; code: number } {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  if (r.error) throw r.error;
  return { ok: r.status === 0, code: r.status ?? -1 };
}
