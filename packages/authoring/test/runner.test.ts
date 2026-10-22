// The A1 runner with a stub llm (PLAN 8.1 A1 note 1): a simulated cap error pauses all sessions,
// discards (quarantines) the in-flight ones and resumes after the reset; the kept set equals that
// of an uninterrupted run; the session and $ ceilings stop the run. Concurrency comes from T0's
// throughput.json.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { capOf } from '../src/a1.ts';
import { buildExport, textSource } from '../src/export.ts';
import { keepRule } from '../src/keep.ts';
import { concurrencyFromThroughput, type RunnerEvent, runJobs } from '../src/runner.ts';
import { runAuthorSession } from '../src/session.ts';
import { stubDeps } from '../src/stub.ts';

interface Job {
  id: string;
  ideaIndex: number;
}
const JOBS: Job[] = Array.from({ length: 12 }, (_, i) => ({
  id: `shop-realistic-${String(i).padStart(3, '0')}`,
  ideaIndex: i,
}));
/** Stub validity, a fixed function of the idea (as validate-drift is of the package). */
const VALID = (j: Job) => j.ideaIndex % 3 !== 1;
const QUOTAS = { realistic: { n: 5 } };

/** One real (stub-llm) session per job; the stub caps on the given global call numbers. */
function harness(capOnCalls: number[], costUsd = 0.1) {
  let calls = 0;
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const deps = stubDeps(() => {
    const n = ++calls;
    return capOnCalls.includes(n)
      ? { cap: { resetsAt }, latencyMs: 20 }
      : { text: 'ok', costUsd, latencyMs: 40 + (n % 4) * 15 };
  });
  const root = mkdtempSync(join(tmpdir(), 'blind-runner-'));
  const quarantined: string[] = [];
  const events: RunnerEvent[] = [];
  const sleeps: number[] = [];
  const run = (concurrency: number, ceiling?: { usd?: number; sessions?: number }) =>
    runJobs<Job, boolean>({
      jobs: JOBS,
      concurrency,
      ...(ceiling ? { ceiling } : {}),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: (e) => events.push(e),
      quarantine: (job, _i, ctx, reason) => {
        quarantined.push(`${job.id}#${ctx.attempt}:${reason}`);
      },
      async run(job, i, ctx) {
        const exp = buildExport({
          kind: 'drift',
          label: `${job.id}-a${ctx.attempt}`,
          root,
          files: [textSource('blind/IDEA.md', job.id)],
        });
        const r = await runAuthorSession({
          kind: 'drift',
          label: `${job.id}.a${ctx.attempt}`,
          exportDir: exp.dir,
          prompt: `implement ${job.id}`,
          model: 'claude-opus-5-5',
          tools: ['Read'],
          budget: { maxTurns: 5, maxBudgetUsd: 1 },
          logDir: join(root, 'logs'),
          deps: { ...deps, sleep: async () => {} },
        });
        const cap = capOf<boolean>(r.session, r.session.costUsd);
        if (cap) return cap;
        expect(i).toBe(job.ideaIndex);
        return { kind: 'ok', value: VALID(job), costUsd: r.session.costUsd, sessions: 1 };
      },
    });
  return { run, quarantined, events, sleeps, calls: () => calls, resetsAt };
}

const keptIds = (results: ({ kind: string; value?: boolean } | undefined)[]) =>
  keepRule(
    JOBS.filter((_, i) => results[i]?.kind === 'ok').map((j) => ({
      id: j.id,
      domain: 'shop',
      stratum: 'realistic',
      ideaIndex: j.ideaIndex,
      valid: (results[j.ideaIndex] as { value: boolean }).value,
    })),
    QUOTAS,
  ).kept.map((k) => k.id);

describe('A1 runner', () => {
  test('a cap pauses everything, discards the in-flight sessions, resumes after the reset; the kept set is unchanged', async () => {
    const plain = harness([]);
    const a = await plain.run(3);
    expect(a.capEvents).toEqual([]);
    expect(a.notRun).toEqual([]);
    const keptPlain = keptIds(a.results);
    expect(keptPlain).toHaveLength(5);

    const capped = harness([5]);
    const b = await capped.run(3);
    expect(b.capEvents).toHaveLength(1);
    expect(b.capEvents[0]?.resetAt).toBe(new Date(capped.resetsAt * 1000).toISOString());
    // Paused: no job started between the cap and the resume, and the wait reached the reset.
    const capAt = capped.events.findIndex((e) => e.type === 'cap');
    const resumeAt = capped.events.findIndex((e) => e.type === 'resume');
    expect(capAt).toBeGreaterThan(-1);
    expect(resumeAt).toBeGreaterThan(capAt);
    expect(capped.events.slice(capAt, resumeAt).some((e) => e.type === 'start')).toBe(false);
    expect(capped.sleeps).toHaveLength(1);
    expect(capped.sleeps[0]).toBeGreaterThan(3500_000);
    // The capped session and every in-flight one were discarded, quarantined and re-run.
    const capEvent = capped.events[capAt] as Extract<RunnerEvent, { type: 'cap' }>;
    expect(capEvent.inFlight.length).toBeGreaterThan(0);
    expect(b.discarded.length).toBe(1 + capEvent.inFlight.length);
    expect(capped.quarantined).toHaveLength(b.discarded.length);
    for (const d of b.discarded) {
      const reruns = capped.events.filter(
        (e) => e.type === 'start' && e.index === d.index && e.attempt > d.attempt,
      );
      expect(reruns.length, `job ${d.index} restarted`).toBe(1);
    }
    expect(b.notRun).toEqual([]);
    expect(b.sessions).toBe(12 + b.discarded.length);
    expect(keptIds(b.results)).toEqual(keptPlain);
  });

  test('the session ceiling and the $ ceiling stop the run', async () => {
    const s = await harness([]).run(2, { sessions: 5 });
    expect(s.stoppedBy).toBe('sessions');
    expect(s.sessions).toBeGreaterThanOrEqual(5);
    expect(s.sessions).toBeLessThanOrEqual(6);
    expect(s.notRun.length).toBe(12 - s.sessions);

    const u = await harness([], 0.4).run(1, { usd: 1 });
    expect(u.stoppedBy).toBe('usd');
    expect(u.spentUsd).toBeCloseTo(1.2);
    expect(u.sessions).toBe(3);
    expect(u.notRun).toHaveLength(9);
  });

  test('concurrency comes from throughput.json (T0)', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'blind-tp-')), 'throughput.json');
    const level = (c: number, rate: number) => ({
      concurrency: c,
      sessions: 10,
      ok: 10,
      modelErrors: 0,
      infraErrors: 0,
      caps: 0,
      notRun: 0,
      wallMs: 1000,
      attemptsPerHour: 10,
      rateLimitEvents: 0,
      overloadEvents: 0,
      sessionsWith429OrOverload: 0,
      rateLimitOverloadRate: rate,
      capEvents: [],
      spawnOverheadMs: { n: 0, meanMs: null, medianMs: null, p90Ms: null },
      costUsd: 0,
      tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    });
    writeFileSync(
      f,
      JSON.stringify({
        schema: 'fiks-throughput/1',
        dry: true,
        createdAt: '2026-10-22T00:00:00.000Z',
        fiksCommit: null,
        host: { platform: 'darwin', arch: 'arm64', cpus: 8, memGb: 16, node: 'v22' },
        models: { authoring: 'claude-opus-5-5', repair: 'claude-opus-5-5' },
        authoring: { levels: [level(1, 0), level(2, 0.01), level(4, 0.05)] },
        repairWorkers: null,
        ollama: {
          status: 'skipped',
          reason: 'test',
          model: null,
          digest: null,
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          wallMs: 0,
          tokensPerSec: null,
        },
        capEventsTotal: 0,
        capStopped: null,
        recommendedConcurrency: null,
      }),
    );
    expect(concurrencyFromThroughput(f)).toBe(2);
  });
});
