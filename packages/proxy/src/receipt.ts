import type { EvalResult, Verdict, Violation } from '@fiks/contracts';

export const RECEIPT_META_KEY = 'fiks/receipt';

export interface Receipt {
  v: 1;
  verdict: Verdict;
  contractId: string | null;
  checked: string[];
  violations: Violation[];
  /** Recovery facts observed upstream (see hints.ts). */
  hints?: string[];
  /** False when no tap saw the upstream HTTP: upstream-based checks were skipped. */
  upstreamObserved: boolean;
  traceId?: string;
  at: string;
}

export function makeReceipt(
  e: EvalResult,
  at: Date,
  upstreamObserved: boolean,
  traceId?: string,
  hints: string[] = [],
): Receipt {
  return {
    v: 1,
    verdict: e.verdict,
    contractId: e.contractId,
    checked: e.checked,
    violations: e.violations,
    ...(hints.length ? { hints } : {}),
    upstreamObserved,
    ...(traceId ? { traceId } : {}),
    at: at.toISOString(),
  };
}

/** Prefer the fact that carries the upstream's real value when two concern the same field. */
const FACT_PRIORITY: Record<string, number> = { equalsUpstream: 0, readAfterWrite: 0 };

/** One fact per field, at most `max`, most informative first. */
export function facts(violations: Violation[], max = 3): string[] {
  const byPath = new Map<string, Violation>();
  for (const v of violations) {
    const key = `${v.propertyId.split('/')[0]}:${v.path.replace(/\[\d+\]/g, '[]')}`;
    const prev = byPath.get(key);
    if (!prev || (FACT_PRIORITY[v.kind] ?? 1) < (FACT_PRIORITY[prev.kind] ?? 1)) byPath.set(key, v);
  }
  const all = [...byPath.values()];
  const out = all.slice(0, max).map((v) => v.message);
  if (all.length > max) out.push(`${all.length - max} more in _meta`);
  return out;
}

const field = (v: Violation | undefined) =>
  v?.path
    .split('.')
    .pop()
    ?.replace(/\[\d+\]/g, '') ?? 'value';

/**
 * What the agent should do next. The goal is a correct answer when one is reachable, and an
 * honest "unconfirmed" otherwise: never stop the agent from checking with another tool.
 */
export function nextAction(violations: Violation[], hints: string[] = []): string {
  const kinds = new Set(violations.map((v) => v.kind));
  if (kinds.has('readAfterWrite')) {
    return 'Do not tell the user it succeeded or retry without asking; say it is unconfirmed.';
  }
  if ([...kinds].every((k) => k === 'notNull' || k === 'nonEmpty')) {
    const f = field(violations[0]);
    return hints.length
      ? `Don't say there is no ${f}; if you use the vendor value, say unconfirmed.`
      : `Don't say there is no ${f}; check another tool, or say it could not be read.`;
  }
  if (kinds.has('equalsUpstream') && [...kinds].every((k) => k === 'equalsUpstream' || k === 'freshness')) {
    return "Do not quote the tool's value; give the upstream value if needed, as unconfirmed.";
  }
  const incomplete = kinds.has('countMatchesTotal');
  const wrongValues = [...kinds].some((k) => k !== 'countMatchesTotal');
  if (incomplete && wrongValues) {
    return "Not the full list; don't quote flagged values. Search narrower, then answer.";
  }
  if (incomplete) return 'Not the full list. Search narrower, then answer.';
  return "Don't quote flagged values as is. Check another tool; if you infer a value, say how, as unconfirmed.";
}

/**
 * One short line for the agent: status first, plain facts, observed recovery facts, then the
 * next action. Property ids, the trace id and upstream coverage stay in _meta.
 */
export function receiptText(r: Receipt, tool: string, reason?: string): string {
  if (r.verdict === 'violated') {
    const parts = [...facts(r.violations), ...(r.hints ?? [])];
    return `[fiks] VIOLATED ${tool}: ${parts.join('; ')}. ${nextAction(r.violations, r.hints)}`;
  }
  if (r.verdict === 'verified') {
    const n = r.checked.length;
    return `[fiks] VERIFIED ${tool} (${n} ${n === 1 ? 'check' : 'checks'})`;
  }
  return `[fiks] NOT CHECKED ${tool}: ${reason ?? 'no contract for this tool'}`;
}
