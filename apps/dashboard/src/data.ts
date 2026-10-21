// Types and pure transforms for the dashboard. Every value shown comes from
// public/data/summary.json and public/data/events.jsonl (copied from bench/results).

export interface PhaseSummary {
  runId: string;
  model: string;
  shopMcpSha: string;
  tasks: number;
  k: number;
  trials: number;
  passHatK: number[];
  /** wrong = a submitted wrong answer; noAnswer = never called submit_answer (absent in old summaries). */
  outcomes: { correct: number; wrong: number; declined: number; noAnswer?: number };
  violatedCalls: number;
}

export interface DriftStatus {
  detected: boolean;
  reproValid: boolean;
  prGreen: boolean;
  prUrl: string | null;
  minutesDriftToPr: number | null;
  merged: boolean;
  confirmed: boolean;
  repairAttempts: number | null;
  repairTurns: number | null;
}

export interface Summary {
  generatedAt: string;
  phases: Record<string, PhaseSummary>;
  drifts: Record<string, DriftStatus>;
  falsePositivesV1: number | null;
}

export interface LoopEvent {
  ts: string;
  runId: string;
  type: string;
  traceId?: string;
  propertyId?: string;
  ok?: boolean;
  data?: Record<string, unknown>;
}

/** Phases in reading order, with the words the dashboard uses for them. */
export const PHASES = [
  { key: 'A_v1', label: 'Before the vendor change' },
  { key: 'B_v2_direct', label: 'After the change, without fiks' },
  { key: 'B_v2', label: 'After the change, with fiks receipts' },
  { key: 'C_v2_fixed', label: 'After the fiks PRs were merged' },
  { key: 'C_v2_prheads', label: 'With the fiks PR branches (not merged)' },
] as const;

export interface PhaseRow {
  key: string;
  label: string;
  slot: number;
  phase: PhaseSummary;
}

const slotOf = (i: number) => Math.min(i, 3) + 1;

/** Present phases in reading order. Slot = fixed categorical color slot per phase key. */
export function phaseRows(s: Summary): PhaseRow[] {
  return PHASES.flatMap((p, i) => {
    const phase = s.phases[p.key];
    return phase ? [{ key: p.key, label: p.label, slot: slotOf(i), phase }] : [];
  });
}

export type HeadlineSlot = PhaseRow | { key: string; label: string; slot: number; phase: null };

/**
 * The headline sequence. The after-fix phase keeps its place (and color slot) even before it has
 * been run, so the page does not reflow when it arrives.
 */
export function headlineSlots(rows: PhaseRow[]): HeadlineSlot[] {
  const fixed = PHASES.findIndex((p) => p.key === 'C_v2_fixed');
  const fixPhase = PHASES[fixed];
  if (!fixPhase || rows.some((r) => r.slot === slotOf(fixed))) return rows;
  return [...rows, { key: fixPhase.key, label: fixPhase.label, slot: slotOf(fixed), phase: null }];
}

/** Recharts rows: one per k, one column per phase. */
export function passHatKSeries(rows: PhaseRow[]): Record<string, number>[] {
  const maxK = Math.max(0, ...rows.map((r) => r.phase.passHatK.length));
  return Array.from({ length: maxK }, (_, i) => {
    const point: Record<string, number> = { k: i + 1 };
    for (const r of rows) {
      const v = r.phase.passHatK[i];
      if (v !== undefined) point[r.key] = v;
    }
    return point;
  });
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const DRIFT_NAMES: Record<string, string> = {
  D1: 'Prices sent in cents',
  D2: 'price renamed to unit_amount',
  D3: 'Orders lost without a new header',
  D4: 'Search results paginated',
  D5: 'Timestamps sent as epoch ms',
};

const STEP_LABELS: Record<string, string> = {
  violation: 'Violation caught by fiks-proxy',
  trace_saved: 'Trace captured',
  repro_generated: 'Reproduction test generated',
  gate_F: 'Test fails on the current code',
  repair_started: 'Repair agent started',
  gate_local: 'Fix passes repro, contracts, traces, lint',

  gate_ci: 'CI on the pushed commit',
  pr_opened: 'Pull request opened',
  pr_merged: 'Merged into main',
  confirmed: 'Confirmed on merged main',
};

export interface TimelineStep {
  type: string;
  label: string;
  at: string;
  offsetSeconds: number;
  ok: boolean | undefined;
  url?: string;
  linkText?: string;
  detail?: string;
}

/** Steps after the PR that need a human; shown as "not yet" until their events exist. */
export const AFTER_PR_STEPS = ['pr_merged', 'confirmed'] as const;

export function stepLabel(type: string): string {
  return STEP_LABELS[type] ?? type;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * Evidence for each step, built only from fields in the events: the PR URL gives the repository,
 * the pushed commit pins the files, and the repro event names the test (its trace sits beside it).
 */
function evidence(e: LoopEvent, mine: LoopEvent[]): { url: string; linkText: string } | undefined {
  const own = str(e.data?.url);
  if (own) return { url: own, linkText: own.includes('/pull/') ? prLabel(own) : 'CI run' };
  const pr = str(mine.find((m) => m.type === 'pr_opened')?.data?.url);
  const repo = pr?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+/)?.[0];
  if (!repo) return undefined;
  const pushed = mine.find((m) => m.type === 'branch_pushed')?.data;
  const sha = str(pushed?.sha);
  const ref = sha ?? str(pushed?.branch);
  const testPath = str(mine.find((m) => m.type === 'repro_generated')?.data?.testPath);
  switch (e.type) {
    case 'violation':
    case 'trace_saved':
      return ref && testPath
        ? { url: `${repo}/blob/${ref}/${testPath.replace(/\.test\.ts$/, '.json')}`, linkText: 'trace' }
        : undefined;
    case 'repro_generated':
    case 'gate_F':
      return ref && testPath ? { url: `${repo}/blob/${ref}/${testPath}`, linkText: 'test' } : undefined;
    case 'gate_local':
    case 'branch_pushed':
      return sha ? { url: `${repo}/commit/${sha}`, linkText: 'commit' } : undefined;
    default:
      return undefined;
  }
}

/** "#12" for a GitHub pull request URL, read from the URL itself. */
export function prLabel(url: string): string {
  const n = url.match(/\/pull\/(\d+)/)?.[1];
  return n ? `#${n}` : url;
}

/** The loop for one trace, first event of each kind in order, with time since the violation. */
export function timeline(events: LoopEvent[], traceId: string): TimelineStep[] {
  const mine = events.filter((e) => e.traceId === traceId).sort((a, b) => a.ts.localeCompare(b.ts));
  const start = mine.find((e) => e.type === 'violation') ?? mine[0];
  if (!start) return [];
  const t0 = Date.parse(start.ts);
  const seen = new Set<string>();
  const steps: TimelineStep[] = [];
  for (const e of mine) {
    // Keep the last gate_local (the attempt that passed) and the first of everything else.
    if (e.type !== 'gate_local' && seen.has(e.type)) continue;
    // The push itself is not a step: in the recorded runs it was logged when CI finished.
    if (e.type === 'branch_pushed') continue;
    if (e.type === 'gate_local') {
      const i = steps.findIndex((s) => s.type === 'gate_local');
      if (i >= 0) steps.splice(i, 1);
    }
    seen.add(e.type);
    steps.push({
      type: e.type,
      label: STEP_LABELS[e.type] ?? e.type,
      at: e.ts,
      offsetSeconds: Math.round((Date.parse(e.ts) - t0) / 1000),
      ok: e.ok,
      ...evidence(e, mine),
      detail: str(e.data?.reason) ?? (e.type === 'violation' ? str(e.data?.message) : undefined),
    });
  }
  const order = Object.keys(STEP_LABELS);
  return steps.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

/**
 * The trace a drift's PR came from, read from the pr_opened events. Without a PR, fall back to the
 * last violation recorded for that drift, so a loop that stopped early still shows where it stopped.
 */
export function traceForDrift(events: LoopEvent[], prUrl: string | null, drift?: string): string | undefined {
  if (prUrl) {
    const t = events.find((e) => e.type === 'pr_opened' && e.data?.url === prUrl)?.traceId;
    if (t) return t;
  }
  if (!drift) return undefined;
  return events.findLast((e) => e.type === 'violation' && e.data?.scenario === drift)?.traceId;
}

export function parseEvents(text: string): LoopEvent[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LoopEvent);
}

export function formatOffset(s: number): string {
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m ${String(s - m * 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `+${h}h ${String(m - h * 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `+${d}d ${h - d * 24}h`;
}
