// A1 orchestration (PLAN 8.1 A1): implement ideas in idea-index order through the runner
// (concurrency, cap-stop, ceiling), validate each package, apply the keep rule, then ref B by an
// independent fixer on every kept drift (a drift whose ref B fails validity is dropped and the keep
// rule re-applied), then the realism rating. Writes kept.json and A1-report.json into the blind repo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentSessionResult, isCap } from '@fiks/llm';
import { type DriftContext, fixDrift, type Idea, implementDrift, quarantine, rateDrift } from './drift.ts';
import { DEFAULT_QUOTAS, type KeepCandidate, keepRule, type StratumQuota } from './keep.ts';
import { type JobOutcome, type RunnerEvent, type RunnerReport, runJobs } from './runner.ts';
import type { ValidityReport } from './validate.ts';

export interface A1Options {
  ctx: DriftContext;
  ideas: Idea[];
  validate(pkgFile: string, opts: { requireRefB: boolean }): Promise<ValidityReport>;
  concurrency: number;
  ceiling?: { usd?: number; sessions?: number };
  quotas?: Record<string, StratumQuota>;
  raterModel: string;
  /** Skip the realism rating (e.g. dry runs that only check the package). */
  skipRating?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

interface Implemented {
  id: string;
  pkgFile?: string;
  valid: boolean;
  problems: string[];
  validity?: ValidityReport;
  excludedByAudit: boolean;
}

export interface A1Report {
  implemented: Record<string, Implemented>;
  kept: string[];
  refB: Record<string, { ok: boolean; problems: string[] }>;
  ratings: Record<string, number | null>;
  cells: ReturnType<typeof keepRule>['cells'];
  runner: Omit<RunnerReport<unknown>, 'results'>[];
}

export const capOf = <T>(s: AgentSessionResult, cost: number): JobOutcome<T> | null => {
  if (s.outcome !== 'cap') return null;
  const f = [s.failure, ...s.capEvents].find((x) => x && isCap(x));
  const resetAt = f && isCap(f) ? f.resetAt : undefined;
  return { kind: 'cap', ...(resetAt ? { resetAt } : {}), costUsd: cost, sessions: 1 };
};

export async function runA1(o: A1Options): Promise<A1Report> {
  const say = o.log ?? (() => {});
  const quotas = o.quotas ?? DEFAULT_QUOTAS;
  const events = (e: RunnerEvent) => say(`runner ${JSON.stringify(e)}`);
  const runners: A1Report['runner'] = [];
  const common = {
    concurrency: o.concurrency,
    ...(o.ceiling ? { ceiling: o.ceiling } : {}),
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.now ? { now: o.now } : {}),
    log: events,
  };
  const strip = <R>({ results: _r, ...rest }: RunnerReport<R>) =>
    rest as Omit<RunnerReport<unknown>, 'results'>;

  // Phase 1: implementation + validity (ref A).
  const ordered = [...o.ideas].sort((a, b) => a.ideaIndex - b.ideaIndex);
  const r1 = await runJobs<Idea, Implemented>({
    ...common,
    jobs: ordered,
    async run(idea) {
      const a = await implementDrift(o.ctx, idea);
      const cost = a.run.session.costUsd;
      const cap = capOf<Implemented>(a.run.session, cost);
      if (cap) return cap;
      const impl: Implemented = {
        id: a.id,
        valid: false,
        problems: a.problems,
        excludedByAudit: a.excludedByAudit,
      };
      if (a.pkgFile && !a.problems.length) {
        impl.pkgFile = a.pkgFile;
        impl.validity = await o.validate(a.pkgFile, { requireRefB: false });
        impl.valid = impl.validity.valid;
      }
      return { kind: 'ok', value: impl, costUsd: cost, sessions: 1 };
    },
    quarantine: (idea, _i, ctx, reason) => quarantine(o.ctx.blindRepo, idea.ideaId, ctx.attempt, reason),
  });
  runners.push(strip(r1));
  const implemented: Record<string, Implemented> = {};
  ordered.forEach((idea, i) => {
    const r = r1.results[i];
    if (r?.kind === 'ok') implemented[idea.ideaId] = r.value;
  });

  // Phase 2: keep rule, then ref B on kept drifts until stable.
  const refB: A1Report['refB'] = {};
  const cands = (): KeepCandidate[] =>
    ordered
      .filter((i) => implemented[i.ideaId])
      .map((i) => ({
        id: i.ideaId,
        domain: i.domain,
        stratum: i.stratum,
        ideaIndex: i.ideaIndex,
        valid: !!implemented[i.ideaId]?.valid && refB[i.ideaId]?.ok !== false,
        ...(i.plausibleString ? { plausibleString: true } : {}),
      }));
  let keep = keepRule(cands(), quotas);
  for (;;) {
    const todo = keep.kept.filter((c) => c.stratum !== 'benign' && !refB[c.id]);
    if (!todo.length) break;
    const r2 = await runJobs<KeepCandidate, { ok: boolean; problems: string[] }>({
      ...common,
      jobs: todo,
      async run(c) {
        const pkgFile = implemented[c.id]?.pkgFile as string;
        const f = await fixDrift(o.ctx, pkgFile);
        const cap = capOf<{ ok: boolean; problems: string[] }>(f.run.session, f.run.session.costUsd);
        if (cap) return cap;
        const problems = [...f.problems];
        if (f.ok) {
          const v = await o.validate(pkgFile, { requireRefB: true });
          for (const ch of v.checks) if (!ch.ok) problems.push(`${ch.name}: ${ch.detail}`);
        }
        return {
          kind: 'ok',
          value: { ok: problems.length === 0, problems },
          costUsd: f.run.session.costUsd,
          sessions: 1,
        };
      },
    });
    runners.push(strip(r2));
    todo.forEach((c, i) => {
      const r = r2.results[i];
      if (r?.kind === 'ok') refB[c.id] = r.value;
    });
    if (r2.stoppedBy || r2.notRun.length) break;
    keep = keepRule(cands(), quotas);
  }
  keep = keepRule(cands(), quotas);

  // Phase 3: realism ratings (reported, never used to filter).
  const ratings: Record<string, number | null> = {};
  if (!o.skipRating) {
    const r3 = await runJobs<KeepCandidate, number | null>({
      ...common,
      jobs: keep.kept,
      async run(c) {
        const r = await rateDrift(
          { ...o.ctx, raterModel: o.raterModel },
          implemented[c.id]?.pkgFile as string,
        );
        const cap = capOf<number | null>(r.run.session, r.run.session.costUsd);
        return cap ?? { kind: 'ok', value: r.score, costUsd: r.run.session.costUsd, sessions: 1 };
      },
    });
    runners.push(strip(r3));
    keep.kept.forEach((c, i) => {
      const r = r3.results[i];
      if (r?.kind === 'ok') ratings[c.id] = r.value;
    });
  }

  const report: A1Report = {
    implemented,
    kept: keep.kept.map((c) => c.id),
    refB,
    ratings,
    cells: keep.cells,
    runner: runners,
  };
  mkdirSync(o.ctx.blindRepo, { recursive: true });
  const byId = new Map(ordered.map((i) => [i.ideaId, i]));
  writeFileSync(
    join(o.ctx.blindRepo, 'kept.json'),
    `${JSON.stringify(
      keep.kept
        .filter((c) => c.stratum !== 'benign')
        .map((c) => ({
          id: c.id,
          domain: c.domain,
          stratum: c.stratum,
          ideationFamily: byId.get(c.id)?.family,
        })),
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(o.ctx.blindRepo, 'A1-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
