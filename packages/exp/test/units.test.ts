// Registry, classifier, schedule and input units.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classifyAttempt, EXIT_CAP, EXIT_INFRA } from '../src/classify.ts';
import { devInputs, filterDrifts, manifestInputs } from '../src/inputs.ts';
import { loadRegistry, Registry } from '../src/registry.ts';
import { seededShuffle, stratifiedSubset } from '../src/rng.ts';
import { getRun } from '../src/runs.ts';
import { buildBlocks, type PlanPhase } from '../src/schedule.ts';
import { ROOT, tmp } from './support/harness.ts';

describe('registry', () => {
  test('a torn last line (kill -9) is skipped and the next append starts on a fresh line', () => {
    const f = join(tmp('reg'), 'registry.jsonl');
    const r = new Registry(f);
    r.append({ t: 'checkpoint', at: 'x', blocksDone: 1, blocksTotal: 2 });
    r.close();
    appendFileSync(f, '{"t":"block_complete","block":"b1","ro');
    const st = loadRegistry(f);
    expect(st.skipped).toBe(1);
    expect(st.completeBlocks.size).toBe(0);
    const r2 = new Registry(f);
    r2.append({ t: 'block_complete', at: 'y', block: 'b2', worker: 0, rows: [] });
    r2.close();
    const st2 = loadRegistry(f);
    expect([...st2.completeBlocks.keys()]).toEqual(['b2']);
    expect(readFileSync(f, 'utf8').endsWith('\n')).toBe(true);
  });
});

describe('classifyAttempt', () => {
  const dir = tmp('cls');
  const base = { exitCode: 0, signal: null, spawnError: null, timedOut: false, tail: '', fiksDir: dir };
  test('exit codes, status files and error text', () => {
    expect(classifyAttempt(base).class).toBe('done');
    expect(classifyAttempt({ ...base, exitCode: 1 }).class).toBe('done');
    expect(classifyAttempt({ ...base, exitCode: EXIT_INFRA }).class).toBe('infra');
    expect(classifyAttempt({ ...base, exitCode: EXIT_CAP }).class).toBe('cap');
    expect(classifyAttempt({ ...base, exitCode: null, signal: 'SIGKILL' }).class).toBe('infra');
    expect(classifyAttempt({ ...base, timedOut: true }).class).toBe('infra');
    expect(classifyAttempt({ ...base, exitCode: 3, tail: 'Claude AI usage limit reached' }).class).toBe(
      'cap',
    );
    expect(classifyAttempt({ ...base, exitCode: 3, tail: 'segfault' }).class).toBe('infra');
    const d2 = tmp('cls2');
    mkdirSync(join(d2, 'runs', 'k'), { recursive: true });
    writeFileSync(join(d2, 'runs', 'k', 'result.json'), JSON.stringify({ status: 'infra_error' }));
    expect(classifyAttempt({ ...base, exitCode: 1, fiksDir: d2 }).class).toBe('infra');
    writeFileSync(join(d2, 'runs', 'k', 'result.json'), JSON.stringify({ status: 'gate_failed' }));
    expect(classifyAttempt({ ...base, exitCode: 1, fiksDir: d2 }).class).toBe('done');
  });
});

describe('schedule', () => {
  const inputs = devInputs(ROOT, null, join(ROOT, 'packages/exp/fixtures/dry'));
  const def = getRun('R4');
  if (def.kind !== 'blocks') throw new Error('R4 is a block run');
  const plan: PlanPhase[] = def.phases.map((p) => ({ phase: p, drifts: filterDrifts(inputs, ['D1', 'D2']) }));
  const blocks = buildBlocks(plan, {
    runId: 'R4',
    seed: 's',
    fiks: ['pnpm', 'fiks'],
    traceOf: (d) => `/t/${d.id}.json`,
    dry: false,
    reproStub: '/x',
    extraArms: [],
  });

  test('blocks hold every arm of the phase; confirmatory first; breadth-first over the attempt index', () => {
    const conf = blocks.filter((b) => b.phase === 'confirmatory');
    expect(conf).toHaveLength(2 * 3 * 4);
    for (const b of conf) expect(b.jobs.map((j) => j.arm).sort()).toEqual(['COMP', 'FIKS', 'L1']);
    expect(blocks.findIndex((b) => b.phase === 'rungs')).toBe(conf.length);
    const attempts = conf.map((b) => b.attempt);
    expect(attempts).toEqual([...attempts].sort((a, b) => a - b));
    expect(
      blocks
        .filter((b) => b.phase === 'rungs')
        .every((b) => b.jobs.length === 4 && b.model === 'claude-opus-5-5'),
    ).toBe(true);
  });

  test('no live argv carries --agent-stub; run keys are unique', () => {
    const keys = blocks.flatMap((b) => b.jobs.map((j) => j.runKey));
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of blocks) for (const j of b.jobs) expect(j.argv).not.toContain('--agent-stub');
  });
});

describe('inputs and rng', () => {
  test('dev split: D1-D5, DEV-X1, TRK-DEV-1 with their DriftPackage bases; unknown --drifts ids fail', () => {
    const dev = devInputs(ROOT, null, '/stubs');
    expect(dev.map((d) => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'DEV-X1', 'TRK-DEV-1']);
    expect(dev.find((d) => d.id === 'D1')?.base).toBe('seed-v1');
    expect(dev.find((d) => d.id === 'DEV-X1')?.base).toBe('base-shop');
    expect(dev.find((d) => d.id === 'TRK-DEV-1')).toMatchObject({
      domain: 'tracker',
      base: 'dev-tracker-stub',
    });
    expect(() => filterDrifts(dev, ['D9'])).toThrow(/unknown drift/);
  });

  test('a manifest needs id, domain, base and trace; paths resolve against it', () => {
    const d = tmp('man');
    writeFileSync(
      join(d, 'm.json'),
      JSON.stringify({ drifts: [{ id: 'T1', domain: 'shop', base: 'b', trace: 't.json' }] }),
    );
    expect(manifestInputs(join(d, 'm.json'), '/s')[0]?.trace).toBe(join(d, 't.json'));
    writeFileSync(join(d, 'bad.json'), JSON.stringify([{ id: 'T1', domain: 'shop', base: 'b' }]));
    expect(() => manifestInputs(join(d, 'bad.json'), '/s')).toThrow(/trace/);
  });

  test('seeded shuffle and stratified subset are deterministic', () => {
    const xs = Array.from({ length: 61 }, (_, i) => `T${i}`);
    expect(seededShuffle(xs, 'a', 'l')).toEqual(seededShuffle(xs, 'a', 'l'));
    expect(seededShuffle(xs, 'a', 'l')).not.toEqual(seededShuffle(xs, 'b', 'l'));
    const strat = (x: string) => (Number(x.slice(1)) % 3 === 0 ? 'evasive' : 'realistic');
    const sub = stratifiedSubset(xs, 40, 'k1', 'S4', strat);
    expect(sub).toHaveLength(40);
    expect(sub).toEqual(stratifiedSubset(xs, 40, 'k1', 'S4', strat));
    const share = sub.filter((x) => strat(x) === 'evasive').length / 40;
    expect(Math.abs(share - xs.filter((x) => strat(x) === 'evasive').length / 61)).toBeLessThan(0.05);
  });
});
