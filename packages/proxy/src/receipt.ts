import type { EvalResult, Verdict, Violation } from '@fiks/contracts';

export const RECEIPT_META_KEY = 'fiks/receipt';

export interface Receipt {
  v: 1;
  verdict: Verdict;
  contractId: string | null;
  checked: string[];
  violations: Violation[];
  /** False when no tap saw the upstream HTTP: upstream-based checks were skipped. */
  upstreamObserved: boolean;
  traceId?: string;
  at: string;
}

export function makeReceipt(e: EvalResult, at: Date, upstreamObserved: boolean, traceId?: string): Receipt {
  return {
    v: 1,
    verdict: e.verdict,
    contractId: e.contractId,
    checked: e.checked,
    violations: e.violations,
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

/** What the agent should do next, from the kinds of problems found. */
export function nextAction(violations: Violation[]): string {
  const kinds = new Set(violations.map((v) => v.kind));
  if (kinds.has('readAfterWrite')) {
    return 'Do not tell the user it succeeded or retry without asking; say it is unconfirmed.';
  }
  if ([...kinds].every((k) => k === 'notNull' || k === 'nonEmpty')) {
    const field =
      violations[0]?.path
        .split('.')
        .pop()
        ?.replace(/\[\d+\]/g, '') ?? 'value';
    return `Do not treat the missing ${field} as meaningful; tell the user it is unavailable right now.`;
  }
  if (kinds.has('equalsUpstream') && [...kinds].every((k) => k === 'equalsUpstream' || k === 'freshness')) {
    return "Do not quote the tool's value; give the upstream value if needed, as unconfirmed.";
  }
  const incomplete = kinds.has('countMatchesTotal');
  const wrongValues = [...kinds].some((k) => k !== 'countMatchesTotal');
  if (incomplete && wrongValues) return 'Do not quote these values or call the list complete; tell the user.';
  if (incomplete) return 'Do not call this the full list; tell the user, or search a narrower term.';
  return 'Do not quote flagged values; tell the user they could not be confirmed.';
}

/**
 * One short line for the agent: status first, plain facts, then the next action.
 * Examples:
 *   [fiks] VIOLATED get_product: price is null, but p-1001 should have one. Do not treat the missing ...
 *   [fiks] VERIFIED get_product (3 checks)
 *   [fiks] NOT CHECKED get_product: the tool returned an error
 */
export function receiptText(r: Receipt, tool: string, reason?: string): string {
  // Trace ids and upstream coverage are for operators: they live in _meta, not in the agent's text.
  if (r.verdict === 'violated') {
    return `[fiks] VIOLATED ${tool}: ${facts(r.violations).join('; ')}. ${nextAction(r.violations)}`;
  }
  if (r.verdict === 'verified') {
    const n = r.checked.length;
    return `[fiks] VERIFIED ${tool} (${n} ${n === 1 ? 'check' : 'checks'})`;
  }
  return `[fiks] NOT CHECKED ${tool}: ${reason ?? 'no contract for this tool'}`;
}
