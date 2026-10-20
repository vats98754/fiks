import {
  type EvalResult,
  getOne,
  type HttpExchange,
  type Invariant,
  type ToolContract,
} from '@fiks/contracts';

/**
 * Facts from the upstream response that help the agent recover, attached to a violated receipt.
 * They are observations only (what the vendor sent, what fiks checked), never guesses:
 * - notNull: upstream fields the tool dropped whose values pass the contract's own checks for
 *   the missing field (e.g. a renamed `unit_amount` that fits the price range);
 * - countMatchesTotal: the total itself matched the vendor;
 * - readAfterWrite: what the vendor answered to the read-back.
 */
export function receiptHints(input: {
  contract: ToolContract | undefined;
  evaluation: EvalResult;
  structured: Record<string, unknown> | undefined;
  upstream: HttpExchange[] | undefined;
  probeUpstream: HttpExchange[] | undefined;
}): string[] {
  const { contract, evaluation } = input;
  if (!contract || evaluation.verdict !== 'violated') return [];
  const hints: string[] = [];
  const body = parseFirst(input.upstream);
  for (const v of evaluation.violations) {
    if (v.kind === 'notNull' && body && typeof body === 'object' && !Array.isArray(body)) {
      const ranges = contract.invariants.filter(
        (i): i is Extract<Invariant, { kind: 'range' }> => i.kind === 'range' && i.path === v.path,
      );
      const outKeys = new Set(Object.keys(input.structured ?? {}));
      const candidates = Object.entries(body as Record<string, unknown>)
        .filter(([k, val]) => !outKeys.has(k) && typeof val === 'number')
        .filter(([, val]) =>
          ranges.every(
            (r) =>
              (r.min === undefined || (val as number) >= r.min) &&
              (r.max === undefined || (val as number) <= r.max),
          ),
        )
        .slice(0, 2);
      const range = ranges[0];
      const fits = range
        ? ` (in ${range.min ?? '-inf'}-${range.max ?? 'inf'}${range.unit ? ` ${range.unit}` : ''})`
        : '';
      for (const [k, val] of candidates) hints.push(`vendor sent ${k} = ${val}${fits}`);
    }
    if (v.kind === 'countMatchesTotal') {
      const inv = contract.invariants.find((i) => i.kind === 'countMatchesTotal');
      const totalPath = inv && inv.kind === 'countMatchesTotal' ? inv.totalPath : undefined;
      const totalCheck = contract.invariants.find((i) => i.kind === 'equalsUpstream' && i.path === totalPath);
      const id = totalCheck ? `${contract.id}/${totalCheck.id}` : undefined;
      const held =
        id && evaluation.checked.includes(id) && !evaluation.violations.some((x) => x.propertyId === id);
      if (held && input.structured)
        hints.push(`${totalPath} ${String(getOne(input.structured, totalPath ?? ''))} verified`);
    }
    if (v.kind === 'readAfterWrite' && input.probeUpstream?.length) {
      const last = input.probeUpstream.at(-1) as HttpExchange;
      hints.push(`vendor answered ${last.response.status}`);
    }
  }
  return [...new Set(hints)];
}

function parseFirst(http: HttpExchange[] | undefined): unknown {
  const first = http?.[0];
  if (!first) return undefined;
  try {
    return JSON.parse(first.response.body);
  } catch {
    return undefined;
  }
}
