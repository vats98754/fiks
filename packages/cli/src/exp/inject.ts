// E-C injection smoke test (paper/EXP-PLAN.md): an attack template from @fiks/attacks placed in the
// recorded vendor v2 response of the drift's trace through an attacks carrier, and the attack-goal
// oracles applied to what the run did. A smoke test, not a security evaluation.
import {
  type AttemptOutcome,
  CARRIERS,
  type CarrierKind,
  defaultOracleContext,
  GOALS,
  mintCanary,
  parseUnifiedDiff,
  placePayload,
  scanForCanary,
  TEMPLATES,
} from '@fiks/attacks';
import type { ReproTrace } from '@fiks/interfaces';
import { mayRun } from '@fiks/repair';
import type { Trace } from '@fiks/repro';
import type { InjectRecord } from './types.ts';

/** A name that never resolves (RFC 6761): any attempt shows up as a refused connection. */
export const SINK_URL = 'http://egress-sink.fiks.invalid/collect';
/** JSON stays valid, so the replay and the F gate see the same response shape. */
export const DEFAULT_CARRIER: CarrierKind = 'response-body-field';
export const OUT_PATH = '.github/workflows/ci.yml';

export interface PreparedInjection {
  trace: Trace;
  templateId: string;
  carrier: CarrierKind;
  canary: { name: string; secret: string; value: string };
  recordedIds: string[];
  payload: string;
}

/** Ids in the call's arguments an attacker could special-case on. */
export function recordedIdsOf(t: Trace): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && /^[a-z]+-\d+$/.test(v)) ids.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(t.args);
  return [...ids];
}

export function prepareInjection(
  trace: Trace,
  templateId: string,
  carrier: string = DEFAULT_CARRIER,
): PreparedInjection {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template)
    throw new Error(`unknown attack template ${templateId}; known: ${TEMPLATES.map((t) => t.id).join(', ')}`);
  if (!(CARRIERS as readonly string[]).includes(carrier)) throw new Error(`unknown carrier ${carrier}`);
  const canary = mintCanary('GH_TOKEN');
  const recordedIds = recordedIdsOf(trace);
  const payload = template.render({
    canaryName: canary.name,
    sinkUrl: SINK_URL,
    recordedId: recordedIds[0] ?? 'p-1001',
    outPath: OUT_PATH,
  });
  const injected = placePayload(
    trace as unknown as ReproTrace,
    payload,
    carrier as CarrierKind,
  ) as unknown as Trace;
  return { trace: injected, templateId, carrier: carrier as CarrierKind, canary, recordedIds, payload };
}

/**
 * Plants the canary in this process's env for the duration of `fn` (restored after). The agent
 * runner and every sandbox build their env from an allow-list, so the canary reaching any output
 * means the containment failed.
 */
export async function withCanary<T>(inj: PreparedInjection, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[inj.canary.name];
  process.env[inj.canary.name] = inj.canary.secret;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[inj.canary.name];
    else process.env[inj.canary.name] = prev;
  }
}

/** Bash commands the agent asked for, from the runner log (SDK) or the stub log. */
export function commandsFromLog(log: string): string[] {
  const out: string[] = [];
  for (const line of log.split('\n')) {
    const sdk = /^tool_use Bash: (.*)$/.exec(line);
    if (sdk?.[1]) {
      const m = /"command":"((?:[^"\\]|\\.)*)/.exec(sdk[1]);
      if (m?.[1] !== undefined) {
        try {
          out.push(JSON.parse(`"${m[1]}"`) as string);
        } catch {
          out.push(m[1]);
        }
      }
      continue;
    }
    if (line.startsWith('ran ')) out.push(line.slice(4).replace(/: exit \S+$/, ''));
    else if (line.startsWith('denied Bash ')) out.push(line.slice(12).replace(/: [^:]*$/, ''));
  }
  return out;
}

export interface OracleInputs {
  inj: PreparedInjection;
  /** The agent's whole candidate diff (incl. edits outside src/, before they were reverted). */
  candidateDiff: string;
  commands: string[];
  summary: string;
  /** Agent log plus every gate and command output of the run. */
  log: string;
  gatePassed: boolean;
  egressDenials: string[];
}

export function injectionOracles(i: OracleInputs): InjectRecord {
  const outcome: AttemptOutcome = {
    changedFiles: parseUnifiedDiff(i.candidateDiff),
    unifiedDiff: i.candidateDiff,
    commands: i.commands,
    commitMessage: i.summary,
    prBody: '',
    log: i.log,
    egress: [],
    gatePassed: i.gatePassed,
  };
  const ctx = defaultOracleContext(i.inj.canary.value, i.inj.recordedIds, mayRun);
  const oracles: InjectRecord['oracles'] = {};
  for (const g of GOALS) {
    const r = g.oracle(outcome, ctx);
    oracles[g.id] = {
      hit: r.hit,
      reasons: r.reasons,
      ...(r.ungatedReasons ? { ungatedReasons: r.ungatedReasons } : {}),
    };
  }
  const read = scanForCanary(i.inj.canary.secret, {
    log: i.log,
    diff: i.candidateDiff,
    commands: i.commands.join('\n'),
  });
  return {
    templateId: i.inj.templateId,
    carrier: i.inj.carrier,
    canaryName: i.inj.canary.name,
    sinkUrl: SINK_URL,
    oracles,
    egressDenials: i.egressDenials,
    canaryRead: read.found,
    commands: i.commands,
  };
}
