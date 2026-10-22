// The runner end to end with stub arm commands (FIKS_EXP_FIKS_BIN; --dry only): guards, the
// preflight, dry-mode argv/env, kill -9 + resume, cap stop, worker-count invariance, infra
// re-queue, status-only output.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { AttemptRow, RegistryEvent } from '../src/registry.ts';
import { FORBIDDEN_STATUS_WORDS, StatusSchema, statusJsonSchema } from '../src/status.ts';
import { makeEnv, readJsonl, runCli, STUB_LLM, sleep, startCli, TSX } from './support/harness.ts';

const HAIKU = 'claude-haiku-5-5';
type Call = { argv: string[]; forbid: string | null; fiksDir: string | null; oauth: string | null };

const registry = (out: string, run: string) => readJsonl<RegistryEvent>(join(out, run, 'registry.jsonl'));
const completes = (out: string, run: string) =>
  registry(out, run).filter(
    (e): e is Extract<RegistryEvent, { t: 'block_complete' }> => e.t === 'block_complete',
  );
const rows = (out: string, run: string): AttemptRow[] => completes(out, run).flatMap((b) => b.rows);
const armCalls = (log: string) =>
  readJsonl<Call>(log).filter((c) => c.argv[0] === 'repair' || c.argv[0] === 'arm');
const statusLines = (stdout: string) =>
  stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('run-start guards', () => {
  test('with $HOME/.fiks/build-swarm.active, T0 and R1 without --dry exit non-zero with a clear message', async () => {
    const e = makeEnv();
    writeFileSync(join(e.home, '.fiks', 'build-swarm.active'), 'swarm\n');
    const live = { ...e.env };
    for (const k of ['FIKS_EXP_REPO', 'FIKS_EXP_FIKS_BIN', 'FIKS_EXP_TSX_BIN', 'FIKS_EXP_PREFLIGHT_CMD'])
      delete live[k];
    for (const run of ['T0', 'R1']) {
      const r = await runCli([run, '--out-root', e.out], live);
      expect(r.code, run).not.toBe(0);
      expect(r.stderr).toMatch(/build-swarm\.active exists/);
      expect(readJsonl(e.log)).toEqual([]);
    }
    expect(existsSync(join(e.home, '.fiks', 'run.active'))).toBe(false);
  }, 60_000);

  test('test seams are refused without --dry', async () => {
    const e = makeEnv();
    const r = await runCli(['T0', '--out-root', e.out], e.env);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/may be set only with --dry/);
  }, 30_000);

  test('the runner refuses a dirty tree', async () => {
    const e = makeEnv();
    writeFileSync(join(e.tree, 'untracked.txt'), 'dirty\n');
    const r = await runCli(['R1', '--dry', '--dev', '--drifts', 'D1', '--out-root', e.out], e.env);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/is dirty/);
    expect(readJsonl(e.log)).toEqual([]);
  }, 30_000);
});

describe('--dry', () => {
  test('R1 --dry --dev --drifts D1,D2 --models claude-haiku-5-5 --attempts 1: --agent-stub on every arm, FIKS_LLM_FORBID=1 in every child, 0 LLM calls, |drifts| x |models| x attempts blocks; starts despite build-swarm.active', async () => {
    const e = makeEnv();
    const count = join(e.state, 'llm-calls');
    writeFileSync(count, '');
    writeFileSync(join(e.home, '.fiks', 'build-swarm.active'), 'swarm\n');
    const env = {
      ...e.env,
      FIKS_EXP_FIKS_BIN: JSON.stringify([TSX, STUB_LLM]),
      STUB_LLM_COUNT: count,
      CLAUDE_CODE_OAUTH_TOKEN: 'must-not-reach-children',
    };
    const r = await runCli(
      [
        'R1',
        '--dry',
        '--dev',
        '--drifts',
        'D1,D2',
        '--models',
        HAIKU,
        '--attempts',
        '1',
        '--out-root',
        e.out,
      ],
      env,
      240_000,
    );
    expect(r.code, r.stderr).toBe(0);
    const plan = JSON.parse(readFileSync(join(e.out, 'R1', 'plan.json'), 'utf8')) as {
      blocks: { id: string; jobs: { arm: string; argv: string[] }[] }[];
    };
    expect(plan.blocks).toHaveLength(2 * 1 * 1);
    const calls = readJsonl<Call>(e.log);
    const arms = armCalls(e.log);
    // FIKS, L1, COMP, REPRO-AGENT + the dry-only rungs, per block.
    expect(arms).toHaveLength(2 * 8);
    expect(
      new Set(arms.map((c) => (c.argv[0] === 'repair' ? 'FIKS' : c.argv[c.argv.indexOf('--name') + 1]))).size,
    ).toBe(8);
    for (const c of arms) {
      const stub = c.argv[c.argv.indexOf('--agent-stub') + 1] ?? '';
      expect(c.argv).toContain('--agent-stub');
      expect(stub).toMatch(/packages\/exp\/fixtures\/dry\/(D1|D2|repro-agent)\.json$/);
      expect(existsSync(stub)).toBe(true);
      if (c.argv.includes('REPRO-AGENT')) expect(stub).toMatch(/repro-agent\.json$/);
    }
    for (const c of calls) {
      expect(c.forbid).toBe('1');
      expect(c.oauth).toBeNull();
    }
    expect(readFileSync(count, 'utf8')).toBe('');
    expect(statusLines(r.stdout).at(-1)?.state).toBe('complete');
  }, 300_000);
});

describe('containment preflight', () => {
  const failing = JSON.stringify([process.execPath, '-e', 'process.exit(1)']);

  for (const run of ['R7', 'R4']) {
    test(`mocked to fail: ${run} --dry exits non-zero before any block starts`, async () => {
      const e = makeEnv({ FIKS_EXP_PREFLIGHT_CMD: failing });
      const r = await runCli([run, '--dry', '--out-root', e.out], e.env);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/containment preflight failed/);
      expect(readJsonl(e.log)).toEqual([]);
      expect(existsSync(join(e.out, run, 'registry.jsonl'))).toBe(false);
      expect(existsSync(join(e.out, run, 'meta.json'))).toBe(false);
    }, 60_000);
  }

  test('passing: meta.json records the preflight result (command, exit, commit, image digests)', async () => {
    const e = makeEnv();
    const r = await runCli(
      [
        'R4',
        '--dry',
        '--dev',
        '--drifts',
        'D1',
        '--models',
        'claude-opus-5-5',
        '--attempts',
        '1',
        '--out-root',
        e.out,
      ],
      e.env,
      120_000,
    );
    expect(r.code, r.stderr).toBe(0);
    const meta = JSON.parse(readFileSync(join(e.out, 'R4', 'meta.json'), 'utf8'));
    expect(meta.preflight.passed).toBe(true);
    expect(meta.preflight.exitCode).toBe(0);
    expect(meta.preflight.fiksCommit).toBe(meta.fiksCommit);
    expect(meta.preflight).toHaveProperty('imageDigests');
    expect(meta.preflight.overridden).toBe(true);
  }, 180_000);

  test('T0, A0 and R2 do not run the preflight', async () => {
    const e = makeEnv();
    const marker = join(e.state, 'preflight-ran');
    const env = {
      ...e.env,
      FIKS_EXP_PREFLIGHT_CMD: JSON.stringify([
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`,
      ]),
    };
    writeFileSync(
      join(e.state, 'split.json'),
      JSON.stringify({ test: [{ id: 'T001', domain: 'shop', pkg: 'p.json' }] }),
    );
    for (const run of ['T0', 'A0', 'R2']) {
      const args = [
        run,
        '--dry',
        '--out-root',
        e.out,
        ...(run === 'R2' ? ['--split', join(e.state, 'split.json')] : []),
      ];
      const r = await runCli(args, env, 120_000);
      expect(r.code, `${run}: ${r.stderr}`).toBe(0);
      expect(JSON.parse(readFileSync(join(e.out, run, 'meta.json'), 'utf8')).preflight).toBeNull();
    }
    expect(existsSync(marker)).toBe(false);
    // ... while R1 does.
    const r1 = await runCli(
      ['R1', '--dry', '--dev', '--drifts', 'D1', '--models', HAIKU, '--attempts', '1', '--out-root', e.out],
      env,
      120_000,
    );
    expect(r1.code, r1.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
  }, 300_000);
});

const R1_ARGS = (out: string, more: string[] = []) => [
  'R1',
  '--dry',
  '--dev',
  '--drifts',
  'D1,D2',
  '--out-root',
  out,
  ...more,
];

function assertCompleteAndUnique(out: string, expectBlocks: number) {
  const plan = JSON.parse(readFileSync(join(out, 'R1', 'plan.json'), 'utf8')) as {
    blocks: { id: string; jobs: { runKey: string }[] }[];
  };
  const done = completes(out, 'R1');
  expect(new Set(done.map((b) => b.block)).size).toBe(expectBlocks);
  expect(done).toHaveLength(expectBlocks);
  expect(plan.blocks).toHaveLength(expectBlocks);
  const keys = rows(out, 'R1').map((r) => r.runKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set(plan.blocks.flatMap((b) => b.jobs.map((j) => j.runKey))));
  // Each completed block holds every arm of its plan entry.
  for (const b of done) {
    const want = plan.blocks.find((p) => p.id === b.block)?.jobs.map((j) => j.runKey);
    expect(b.rows.map((r) => r.runKey)).toEqual(want);
  }
}

describe('kill-safe resume', () => {
  test('kill -9 mid-run, then resume: registry complete, no duplicate run keys, incomplete blocks re-run whole', async () => {
    const e = makeEnv({ STUB_SLEEP_MS: '150' });
    const args = R1_ARGS(e.out, [
      '--models',
      `${HAIKU},claude-sonnet-5-5`,
      '--attempts',
      '2',
      '--workers',
      '2',
    ]);
    const run = startCli(args, e.env);
    const t0 = Date.now();
    while (completes(e.out, 'R1').length < 2 && Date.now() - t0 < 120_000) await sleep(100);
    // Make sure a block is in flight at the kill.
    while (
      !(existsSync(join(e.out, 'R1', 'inflight')) && readdirSync(join(e.out, 'R1', 'inflight')).length > 0) &&
      Date.now() - t0 < 120_000
    )
      await sleep(20);
    process.kill(-(run.child.pid as number), 'SIGKILL');
    await run.exited;
    const before = completes(e.out, 'R1').length;
    expect(before).toBeGreaterThanOrEqual(2);
    expect(before).toBeLessThan(8);

    const resumed = await runCli(args, { ...e.env, STUB_SLEEP_MS: '0' }, 180_000);
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(resumed.stderr).toMatch(/discarded \d+ incomplete block/);
    assertCompleteAndUnique(e.out, 8);
    const discarded = registry(e.out, 'R1').filter((x) => x.t === 'block_discarded');
    expect(discarded.length).toBeGreaterThanOrEqual(1);
    for (const d of discarded)
      expect(completes(e.out, 'R1').some((c) => c.block === (d as { block: string }).block)).toBe(true);
    expect(readdirSync(join(e.out, 'R1', 'inflight'))).toEqual([]);
    const meta = JSON.parse(readFileSync(join(e.out, 'R1', 'meta.json'), 'utf8'));
    expect(meta.resumes).toHaveLength(1);
    expect(meta.resumes[0].preflight.passed).toBe(true);
  }, 400_000);

  test('a resume with a different seed is refused', async () => {
    const e = makeEnv();
    const args = R1_ARGS(e.out, ['--models', HAIKU, '--attempts', '1', '--drifts', 'D1']);
    expect((await runCli(args, e.env, 120_000)).code).toBe(0);
    const r = await runCli([...args, '--seed', 'other'], e.env);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/refused to resume/);
  }, 200_000);
});

describe('cap stop', () => {
  test('a simulated cap stop leaves only complete blocks; the incomplete block is re-run whole on resume', async () => {
    const capKey = `R1/L1/${HAIKU}/shop/D2/1`;
    const e = makeEnv({ STUB_CAP_ONCE: capKey });
    const args = R1_ARGS(e.out, ['--models', HAIKU, '--attempts', '2']);
    const first = await runCli(args, e.env, 180_000);
    expect(first.code, first.stderr).toBe(3);
    const reg = registry(e.out, 'R1');
    expect(reg.some((x) => x.t === 'cap_stop')).toBe(true);
    const capBlock = `pilot/D2/${HAIKU}/1`;
    expect(completes(e.out, 'R1').map((b) => b.block)).toEqual([`pilot/D1/${HAIKU}/1`]);
    const disc = reg.find((x) => x.t === 'block_discarded') as {
      block: string;
      quarantine: string | null;
      reason: string;
    };
    expect(disc.block).toBe(capBlock);
    expect(disc.reason).toBe('cap_stop');
    expect(statusLines(first.stdout).at(-1)).toMatchObject({ state: 'paused', pauseReason: 'cap' });
    const armsBefore = armCalls(e.log).filter((c) => c.argv.join(' ').includes('/D2/1')).length;

    const resumed = await runCli(args, e.env, 180_000);
    expect(resumed.code, resumed.stderr).toBe(0);
    assertCompleteAndUnique(e.out, 4);
    // The cap block's arms that ran before the cap ran again on resume (re-run whole).
    const d2a1 = armCalls(e.log).filter((c) => c.argv.join(' ').includes('/D2/1'));
    expect(d2a1.length).toBe(armsBefore + 8);
    if (disc.quarantine) expect(existsSync(join(e.out, 'R1', disc.quarantine))).toBe(true);
  }, 400_000);
});

describe('infra errors (PLAN 9.3)', () => {
  test('re-queued <= 2 times; a persistent infra error drops the cell for all arms and is counted', async () => {
    const flaky = `R1/COMP/${HAIKU}/shop/D1/1`;
    const e = makeEnv({ STUB_INFRA: `${flaky}:2` });
    const args = R1_ARGS(e.out, ['--models', HAIKU, '--attempts', '1', '--drifts', 'D1']);
    const r = await runCli(args, e.env, 180_000);
    expect(r.code, r.stderr).toBe(0);
    const row = rows(e.out, 'R1').find((x) => x.runKey === flaky);
    expect(row?.tries).toBe(3);
    expect(statusLines(r.stdout).at(-1)?.infraRetries).toBe(2);

    const dead = `R1/COMP/${HAIKU}/shop/D2/1`;
    const e2 = makeEnv({ STUB_INFRA: `${dead}:9` });
    const r2 = await runCli(R1_ARGS(e2.out, ['--models', HAIKU, '--attempts', '1']), e2.env, 180_000);
    expect(r2.code, r2.stderr).toBe(0);
    const dropped = registry(e2.out, 'R1').filter((x) => x.t === 'block_dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ block: `pilot/D2/${HAIKU}/1`, arm: 'COMP', tries: 3 });
    expect(rows(e2.out, 'R1').some((x) => x.runKey.includes('/D2/'))).toBe(false);
    expect(statusLines(r2.stdout).at(-1)?.blocksDropped).toBe(1);
  }, 400_000);
});

describe('workers and seeds', () => {
  test('2-worker vs 1-worker runs of stub arms give identical outcome rows; arm order is reproducible from the seed', async () => {
    const strip = (r: AttemptRow) => ({ ...r, wallMs: 0 });
    const sortRows = (rs: AttemptRow[]) =>
      [...rs].sort((a, b) => a.runKey.localeCompare(b.runKey)).map(strip);
    const base = ['--models', HAIKU, '--attempts', '1', '--drifts', 'D1,D2,D3'];
    const one = makeEnv();
    const two = makeEnv();
    const [a, b] = await Promise.all([
      runCli(R1_ARGS(one.out, [...base, '--workers', '1']), one.env, 240_000),
      runCli(R1_ARGS(two.out, [...base, '--workers', '2']), two.env, 240_000),
    ]);
    expect(a.code, a.stderr).toBe(0);
    expect(b.code, b.stderr).toBe(0);
    expect(sortRows(rows(two.out, 'R1'))).toEqual(sortRows(rows(one.out, 'R1')));
    expect(rows(one.out, 'R1').every((r) => r.resultSha)).toBe(true);
    const order = (out: string) =>
      (
        JSON.parse(readFileSync(join(out, 'R1', 'plan.json'), 'utf8')) as {
          blocks: { id: string; jobs: { arm: string }[] }[];
        }
      ).blocks.map((x) => [x.id, x.jobs.map((j) => j.arm)]);
    expect(order(two.out)).toEqual(order(one.out));
    // Another seed gives another order; the same seed the same.
    const p1 = await runCli(R1_ARGS(one.out, [...base, '--print-plan', '--seed', 's-1']), one.env);
    const p2 = await runCli(R1_ARGS(one.out, [...base, '--print-plan', '--seed', 's-1']), one.env);
    const p3 = await runCli(R1_ARGS(one.out, [...base, '--print-plan', '--seed', 's-2']), one.env);
    const arms = (s: string) =>
      (JSON.parse(s) as { blocks: { jobs: { arm: string }[] }[] }).blocks.map((x) =>
        x.jobs.map((j) => j.arm),
      );
    expect(arms(p1.stdout)).toEqual(arms(p2.stdout));
    expect(arms(p3.stdout)).not.toEqual(arms(p1.stdout));
  }, 400_000);
});

describe('status-only output', () => {
  test('every stdout line validates against StatusSchema, which has no correctness or verdict field', async () => {
    const props = Object.keys((statusJsonSchema() as { properties: Record<string, unknown> }).properties);
    for (const p of props)
      for (const w of FORBIDDEN_STATUS_WORDS) expect(p.toLowerCase(), `${p} contains ${w}`).not.toContain(w);
    expect((statusJsonSchema() as { additionalProperties?: unknown }).additionalProperties).toBe(false);
    expect(() =>
      StatusSchema.parse({ ...StatusSchema.parse(sample()), correct: true } as Record<string, unknown>),
    ).toThrow();

    const e = makeEnv();
    const r = await runCli(
      R1_ARGS(e.out, ['--models', HAIKU, '--attempts', '1', '--drifts', 'D1']),
      e.env,
      120_000,
    );
    expect(r.code, r.stderr).toBe(0);
    const lines = statusLines(r.stdout);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(() => StatusSchema.parse(l)).not.toThrow();
    const st = await runCli(['status', 'R1', '--out-root', e.out], e.env);
    expect(st.code, st.stderr).toBe(0);
    const s = StatusSchema.parse(JSON.parse(st.stdout));
    expect(s).toMatchObject({ state: 'complete', blocksDone: 1, blocksTotal: 1 });
    // The arms' own output never reaches stdout.
    expect(r.stdout).not.toMatch(/runKey|would_open_pr|verdict/);
  }, 200_000);
});

function sample() {
  return {
    type: 'status',
    run: 'R1',
    at: new Date().toISOString(),
    state: 'running',
    pauseReason: null,
    phase: null,
    blocksTotal: 1,
    blocksDone: 0,
    blocksDropped: 0,
    blocksInFlight: 0,
    blocksDiscarded: 0,
    attemptsTotal: 1,
    attemptsFinished: 0,
    infraRetries: 0,
    stepsTotal: 0,
    stepsDone: 0,
    workers: 1,
    rssMb: null,
    elapsedMs: 0,
  };
}
