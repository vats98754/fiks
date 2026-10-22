// The keep rule (PLAN 5.1): first valid in authored (idea-index) order until each stratum quota is
// met. Evasive quota: 15 per domain including >= 5 plausible-string (S12) drifts: a valid
// non-S12 candidate is skipped when taking it would leave too few slots for the S12 minimum.
// Pure: the kept set depends only on (candidates, quotas), never on completion order.

export interface KeepCandidate {
  id: string;
  domain: string;
  stratum: string;
  ideaIndex: number;
  valid: boolean;
  plausibleString?: boolean;
}

export interface StratumQuota {
  n: number;
  /** Minimum number of plausible-string (S12) drifts among the kept ones. */
  minPlausibleString?: number;
}

/** Per-domain quotas (PLAN 5.1 table): 45 realistic, 15 evasive (>= 5 S12), 15 benign. */
export const DEFAULT_QUOTAS: Record<string, StratumQuota> = {
  realistic: { n: 45 },
  evasive: { n: 15, minPlausibleString: 5 },
  benign: { n: 15 },
};

export interface KeepReport {
  kept: KeepCandidate[];
  /** Per `domain/stratum`: quota, kept, S12 kept, shortfall. */
  cells: Record<
    string,
    { quota: number; kept: number; plausibleString: number; shortfall: number; s12Shortfall: number }
  >;
}

export function keepRule(
  cands: readonly KeepCandidate[],
  quotas: Record<string, StratumQuota> = DEFAULT_QUOTAS,
): KeepReport {
  const sorted = [...cands].sort((a, b) => a.ideaIndex - b.ideaIndex || (a.id < b.id ? -1 : 1));
  const cells: KeepReport['cells'] = {};
  const kept: KeepCandidate[] = [];
  const cellOf = (c: KeepCandidate) => `${c.domain}/${c.stratum}`;
  for (const c of sorted) {
    const q = quotas[c.stratum];
    if (!q) continue;
    const key = cellOf(c);
    if (!cells[key]) cells[key] = { quota: q.n, kept: 0, plausibleString: 0, shortfall: 0, s12Shortfall: 0 };
    const cell = cells[key];
    if (!c.valid || cell.kept >= q.n) continue;
    const needS12 = Math.max(0, (q.minPlausibleString ?? 0) - cell.plausibleString);
    const slotsLeft = q.n - cell.kept;
    if (!c.plausibleString && slotsLeft <= needS12) continue;
    kept.push(c);
    cell.kept++;
    if (c.plausibleString) cell.plausibleString++;
  }
  for (const [key, cell] of Object.entries(cells)) {
    const q = quotas[key.split('/')[1] as string] as StratumQuota;
    cell.shortfall = q.n - cell.kept;
    cell.s12Shortfall = Math.max(0, (q.minPlausibleString ?? 0) - cell.plausibleString);
  }
  return { kept, cells };
}
