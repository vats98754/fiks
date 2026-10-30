// paper/scripts/exp/detect_numbers.py on a committed fixture: run selection, macro values, the
// table, --check, and an empty results folder.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const SCRIPT = join(ROOT, 'paper/scripts/exp/detect_numbers.py');
const FIXTURE = new URL('./fixtures/detect', import.meta.url).pathname;
const py = (...args: string[]) => spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8' });

function macros(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of readFileSync(file, 'utf8').matchAll(/^\\newcommand\{\\(\w+)\}\{(.*)\}$/gm)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

test('fixture: newest clean run, clean and mutation numbers, table, --check', () => {
  const out = mkdtempSync(join(tmpdir(), 'fiks-detect-num-'));
  const r = py('--dir', FIXTURE, '--out', out);
  expect(r.status, r.stderr).toBe(0);
  const m = macros(join(out, 'exp-detect.tex'));
  // 20261003T000000Z-fixtures has no clean.jsonl; 20261001 is older.
  expect(m.expDetectRunId).toBe('20261002T000000Z');
  expect(m.expDetectCleanCalls).toBe('4');
  expect(m.expDetectCleanViolated).toBe('1');
  expect(m.expDetectCleanEntities).toBe('3');
  expect(m.expDetectCleanEntitiesViolated).toBe('1');
  // Wilson 95% upper bounds: 1/4 calls, 1/3 entities.
  expect(m.expDetectWilsonUpperCall).toBe('69.9\\%');
  expect(m.expDetectWilsonUpperEntity).toBe('79.2\\%');
  expect(m.expDetectRecallMOne).toBe('50.0\\%');
  expect(m.expDetectRecallMFour).toBe('0.0\\%');
  expect(m.expDetectRecallMNine).toBe('--');
  expect(m.expDetectToolErrorMFour).toBe('1');
  expect(m.expDetectMutants).toBe('5');
  expect(m.expDetectMutantsFlagged).toBe('1');
  expect(m.expDetectRecallAll).toBe('20.0\\%');
  expect(m.expDetectRecallSilent).toBe('25.0\\%');
  expect(m.expDetectRecallCoupled).toBe('33.3\\%');
  expect(m.expDetectRecallUncoupled).toBe('0.0\\%');
  expect(m.expDetectFalseAlarmBOne).toBe('50.0\\%');
  expect(m.expDetectBenignApplicable).toBe('3');
  expect(m.expDetectBenignFlagged).toBe('1');
  expect(m.expDetectBenignRate).toBe('33.3\\%');
  expect(m.expDetectControlsMatch).toBe('2');
  for (const name of Object.keys(m)) expect(name).toMatch(/^[A-Za-z]+$/);

  const tab = readFileSync(join(out, 'tab-detect.tex'), 'utf8');
  expect(tab).toContain('M1 & 2 & 1 & 0 & 50.0\\% & range \\\\');
  expect(tab).toContain('M10 & 1 & 0 & 0 & 0.0\\% & enum (no such check) \\\\');
  expect(tab).toContain('M4 & 2 & 0 & 1 & 0.0\\% & no \\\\');
  expect(tab).toContain('B1 & 2 & 1 & 0 & 50.0\\% & -- \\\\');

  expect(py('--dir', FIXTURE, '--out', out, '--check').status).toBe(0);
  writeFileSync(join(out, 'tab-detect.tex'), `${tab}% hand edit\n`);
  const bad = py('--dir', FIXTURE, '--out', out, '--check');
  expect(bad.status).toBe(1);
  expect(bad.stdout).toContain('FAIL tab-detect.tex');
});

test('--run picks a given run; an unknown run is refused', () => {
  const out = mkdtempSync(join(tmpdir(), 'fiks-detect-num-'));
  expect(py('--dir', FIXTURE, '--out', out, '--run', '20261001T000000Z').status).toBe(0);
  const m = macros(join(out, 'exp-detect.tex'));
  expect(m.expDetectCleanViolated).toBe('1');
  expect(m.expDetectCleanCalls).toBe('1');
  // That run has no mutate.jsonl: mutation numbers are "--".
  expect(m.expDetectRecallAll).toBe('--');
  expect(py('--dir', FIXTURE, '--out', out, '--run', 'nope').status).toBe(2);
});

test('empty results folder: every number is "--", outputs still written', () => {
  const out = mkdtempSync(join(tmpdir(), 'fiks-detect-num-'));
  const empty = mkdtempSync(join(tmpdir(), 'fiks-detect-empty-'));
  const r = execFileSync('python3', ['-I', SCRIPT, '--dir', join(empty, 'missing'), '--out', out], {
    encoding: 'utf8',
  });
  expect(r).toContain('no E-B run');
  const m = macros(join(out, 'exp-detect.tex'));
  expect(Object.keys(m).length).toBeGreaterThan(50);
  expect(Object.values(m).every((v) => v === '--')).toBe(true);
  expect(readFileSync(join(out, 'tab-detect.tex'), 'utf8')).toContain('No E-B mutation run yet.');
  expect(py('--dir', join(empty, 'missing'), '--out', out, '--check').status).toBe(0);
});
