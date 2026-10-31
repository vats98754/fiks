// paper/scripts/exp/ablation_numbers.py on a synthetic results dir (written here, in $TMPDIR; the
// records pass the same schema checks as real ones): counts, Wilson intervals, sign tests,
// infra-error exclusions (run and eval), crashed heads counted as failures, not-yet-evaluated
// runs, --check, and an empty dir.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  EVAL_SCHEMA,
  type ExpArm,
  type ExpDrift,
  type ExpEvalRecord,
  type ExpRunRecord,
  RUN_SCHEMA,
  validateEvalRecord,
  validateRunRecord,
} from '../../src/exp/types.ts';
import { scratch } from './support.ts';

const SCRIPT = new URL('../../../../paper/scripts/exp/ablation_numbers.py', import.meta.url).pathname;

const py = (...args: string[]) => spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8' });

interface Spec {
  arm: ExpArm;
  drift: ExpDrift;
  live?: boolean;
  turns?: number;
  cost?: number;
  infra?: boolean;
  noEval?: boolean;
  /** The head's server crashed in every stage (exp-eval headErrors; all outcomes false). */
  crash?: boolean;
  /** exp-eval could not start its sandbox (eval infraError). */
  evalInfra?: boolean;
  experiment?: 'E-A' | 'E-C';
}

let n = 0;
function write(root: string, s: Spec) {
  const runId = `${s.drift}-${s.arm}-r${n}-20261030T000000Z-${(n++).toString(16).padStart(4, '0')}`;
  const sha = 'e'.repeat(40);
  const rec: ExpRunRecord = {
    schema: RUN_SCHEMA,
    runId,
    experiment: s.experiment ?? 'E-A',
    arm: s.arm,
    drift: s.drift,
    rep: 0,
    model: 'synthetic',
    runner: 'stub',
    traceId: 'tr_x',
    traceFile: 'x.json',
    traceSha256: 'a'.repeat(64),
    promptSha256: 'b'.repeat(64),
    base: { ref: 'seed-v1', commit: 'c'.repeat(40) },
    reproCommit: null,
    head: s.infra ? null : { sha, ref: `refs/fiks-exp/${runId}` },
    gates: [],
    gatesPassed: !s.infra && s.live === true,
    diff: { files: [], insertions: 0, deletions: 0 },
    nonSrcEdits: [],
    rerecorded: [],
    outcome: 'completed',
    turns: s.turns ?? 10,
    costUsd: s.cost ?? 0.1,
    durationMs: 1,
    infraError: s.infra ? 'runner: overloaded' : null,
    infraRetries: s.infra ? 3 : 0,
    sandbox: 'docker',
    images: { repo: null, tools: null },
    inject: null,
    startedAt: '2026-10-30T00:00:00.000Z',
    finishedAt: '2026-10-30T00:00:01.000Z',
  };
  expect(validateRunRecord(rec)).toEqual([]);
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'record.json'), JSON.stringify(rec));
  if (s.infra || s.noEval) return;
  const ok = s.live === true && !s.crash && !s.evalInfra;
  const ev: ExpEvalRecord = {
    schema: EVAL_SCHEMA,
    runId,
    control: null,
    arm: s.arm,
    drift: s.drift,
    head: sha,
    base: 'c'.repeat(40),
    heldOutRepro: { ok, reason: '', rerecorded: [], suiteGreen: ok },
    live: {
      drift: { ok, calls: [] },
      v1: { ok: !s.crash && !s.evalInfra, calls: [] },
    },
    liveCheck: ok,
    changedLines: { files: 1, insertions: 1, deletions: 1, lines: 2 },
    sandbox: 'docker',
    evaluatedAt: '2026-10-30T00:00:02.000Z',
    headErrors: s.crash
      ? [
          {
            stage: 'live.drift',
            message: 'scenario D2 in the sandbox exited 1: MCP error -32000: Connection closed',
          },
          { stage: 'live.v1', message: 'scenario v1-all in the sandbox exited 1' },
          { stage: 'heldOutRepro', message: 'the held-out suite could not run on the head' },
        ]
      : [],
    infraError: s.evalInfra ? 'sandbox did not start: docker daemon unreachable' : null,
    infraRetries: s.evalInfra ? 3 : 0,
  };
  expect(validateEvalRecord(ev)).toEqual([]);
  writeFileSync(join(dir, 'eval.json'), JSON.stringify(ev));
}

function wilson(c: number, n: number, z = 1.959964): [number, number] {
  const p = c / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const macros = (text: string) =>
  Object.fromEntries([...text.matchAll(/\\newcommand\{\\(\w+)\}\{([^}]*)\}/g)].map((m) => [m[1], m[2]]));

describe('ablation_numbers.py', () => {
  test('synthetic runs: counts, intervals, sign tests, exclusions, --check', () => {
    const root = scratch();
    const out = scratch();
    // FIKS: D1 2/2, D2 1/2 (+1 infra error). NOHINT: D1 0/2, D2 1/2. ALERT: D1 1/1, D2 unevaluated.
    write(root, { arm: 'fiks', drift: 'D1', live: true, turns: 10, cost: 0.1 });
    write(root, { arm: 'fiks', drift: 'D1', live: true, turns: 14, cost: 0.3 });
    write(root, { arm: 'fiks', drift: 'D2', live: true, turns: 12, cost: 0.2 });
    write(root, { arm: 'fiks', drift: 'D2', live: false, turns: 30, cost: 0.4 });
    write(root, { arm: 'fiks', drift: 'D2', infra: true });
    write(root, { arm: 'nohint', drift: 'D1', live: false });
    write(root, { arm: 'nohint', drift: 'D1', live: false });
    write(root, { arm: 'nohint', drift: 'D2', live: true });
    write(root, { arm: 'nohint', drift: 'D2', live: false });
    write(root, { arm: 'alert', drift: 'D1', live: true });
    write(root, { arm: 'alert', drift: 'D2', live: true, noEval: true });
    // An E-C record in the same tree is not part of the ablation.
    write(root, { arm: 'fiks', drift: 'D2', live: false, experiment: 'E-C' });

    const r = py('--root', root, '--out-dir', out);
    expect(r.status, r.stderr).toBe(0);
    const m = macros(readFileSync(join(out, 'exp-ablation.tex'), 'utf8'));
    expect(m.expAblRecords).toBe('11');
    expect(m.expLiveFiks).toBe('3/4');
    expect(m.expRunsFiks).toBe('4');
    const [lo, hi] = wilson(3, 4);
    expect(m.expLiveLoFiks).toBe(`${Math.round(100 * lo)}\\%`);
    expect(m.expLiveHiFiks).toBe(`${Math.round(100 * hi)}\\%`);
    expect(m.expLiveNohint).toBe('1/4');
    expect(m.expLiveAlert).toBe('1/1');
    expect(m.expInfraFiks).toBe('1');
    expect(m.expIncompleteFiks).toBe('no'); // 1 of 5 = 20%, not more
    expect(m.expUnevaluatedAlert).toBe('1');
    expect(m.expTurnsMedianFiks).toBe('13');
    expect(m.expCostTotalFiks).toBe('1.00');
    expect(m.expInfraTotal).toBe('1');
    // FIKS vs NOHINT: D1 win (1 > 0), D2 tie (0.5 = 0.5) -> 1 win, 0 losses, p = 1.
    expect([m.expSignFiksVsNohintWins, m.expSignFiksVsNohintLosses, m.expSignFiksVsNohintTies]).toEqual([
      '1',
      '0',
      '1',
    ]);
    expect(m.expSignFiksVsNohintP).toBe('1.000');
    // FIKS vs ALERT: D1 tie; D2 has no evaluated ALERT run (skipped).
    expect([m.expSignFiksVsAlertWins, m.expSignFiksVsAlertLosses, m.expSignFiksVsAlertTies]).toEqual([
      '0',
      '0',
      '1',
    ]);
    const tab = readFileSync(join(out, 'tab-ablation.tex'), 'utf8');
    expect(tab).toContain('D1 & FIKS & 2/2 & 2/2 & 2/2 & 0 & 12 & 0.20 & 0 \\\\');
    expect(tab).toContain('D2 & FIKS & 1/2 & 1/2 & 1/2 & 0 & 21 & 0.30 & 1 \\\\');
    expect(tab).toContain('D2 & ALERT & 0/0 & 0/0 & 0/0 & 0 & -- & -- & 0 (+1 not eval.) \\\\');
    expect(tab).toMatch(/All & FIKS & 3\/4 \[\d+\\%--\d+\\%\]/);

    // --check: matches as written, fails after a record changes.
    const ok = py('--check', '--root', root, '--out-dir', out);
    expect(ok.status, ok.stdout).toBe(0);
    write(root, { arm: 'alert', drift: 'D3', live: false });
    const bad = py('--check', '--root', root, '--out-dir', out);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('MISMATCH');
  });

  test('a head that crashes the server is a counted failure, not an exclusion', () => {
    const root = scratch();
    const out = scratch();
    // ALERT on D2: one real fix and two heads whose server crashes (eval headErrors). The rate is
    // 1/3, never 1/1. A separate eval infra error is excluded and labelled as infra.
    write(root, { arm: 'alert', drift: 'D2', live: true, turns: 8, cost: 0.1 });
    write(root, { arm: 'alert', drift: 'D2', crash: true, turns: 9, cost: 0.2 });
    write(root, { arm: 'alert', drift: 'D2', crash: true, turns: 10, cost: 0.3 });
    write(root, { arm: 'alert', drift: 'D3', evalInfra: true });
    const r = py('--root', root, '--out-dir', out);
    expect(r.status, r.stderr).toBe(0);
    const m = macros(readFileSync(join(out, 'exp-ablation.tex'), 'utf8'));
    expect(m.expLiveAlert).toBe('1/3');
    expect(m.expLiveRateAlert).toBe('33\\%');
    expect(m.expHeldOutAlert).toBe('1/3');
    expect(m.expRunsAlert).toBe('3');
    expect(m.expHeadErrorsAlert).toBe('2');
    expect(m.expEvalInfraAlert).toBe('1');
    expect(m.expRunInfraAlert).toBe('0');
    expect(m.expInfraAlert).toBe('1');
    expect(m.expUnevaluatedAlert).toBe('0');
    const tab = readFileSync(join(out, 'tab-ablation.tex'), 'utf8');
    expect(tab).toContain('D2 & ALERT & 1/3 & 1/3 & 1/3 & 2 & 9 & 0.20 & 0 \\\\');
    expect(tab).toContain('D3 & ALERT & 0/0 & 0/0 & 0/0 & 0 & -- & -- & 1 (1 eval) \\\\');
    expect(tab).not.toContain('uneval');
  });

  test('an eval.json from the old schema is refused, not silently dropped', () => {
    const root = scratch();
    write(root, { arm: 'fiks', drift: 'D2', live: true });
    const dir = join(root, readdirSync(root)[0] as string);
    const ev = JSON.parse(readFileSync(join(dir, 'eval.json'), 'utf8'));
    writeFileSync(join(dir, 'eval.json'), JSON.stringify({ ...ev, schema: 'fiks.exp.eval/1', error: 'x' }));
    const r = py('--root', root, '--out-dir', scratch());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('re-run `pnpm fiks exp-eval --force`');
  });

  test('more than 20% infra errors marks an arm incomplete', () => {
    const root = scratch();
    const out = scratch();
    write(root, { arm: 'alert', drift: 'D1', live: true });
    write(root, { arm: 'alert', drift: 'D1', infra: true });
    const r = py('--root', root, '--out-dir', out);
    expect(r.status, r.stderr).toBe(0);
    const m = macros(readFileSync(join(out, 'exp-ablation.tex'), 'utf8'));
    expect(m.expIncompleteAlert).toBe('yes');
    expect(readFileSync(join(out, 'tab-ablation.tex'), 'utf8')).toContain('All & ALERT (incomplete)');
  });

  test('an empty or missing results dir prints "no runs"', () => {
    const out = scratch();
    for (const root of [scratch(), join(scratch(), 'missing')]) {
      const r = py('--root', root, '--out-dir', out);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('no runs');
      expect(readFileSync(join(out, 'tab-ablation.tex'), 'utf8')).toContain('no runs');
      expect(py('--check', '--root', root, '--out-dir', out).status).toBe(0);
    }
  });
});
