// The HOLD CLI commands (packages/cli/src/commands/{grade,pool}.ts) and candidate generation with a
// stub model (no LLM call is possible: FIKS_LLM_FORBID=1 in every child).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { type CandidateRequest, generateCandidates } from '../src/candidates.ts';
import { loadPackage } from '../src/pkg.ts';
import { DEV, FIKS_ROOT, manifestOf, ORACLES, requireShop } from './support/shop.ts';

const tmp = mkdtempSync(join(tmpdir(), 'fiks-heldout-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fiks(args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    join(FIKS_ROOT, 'node_modules/.bin/tsx'),
    [join(FIKS_ROOT, 'packages/cli/src/main.ts'), ...args],
    {
      cwd: FIKS_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? tmp, FIKS_LLM_FORBID: '1', ...env },
    },
  );
}

describe('fiks grade', () => {
  test('--observe refuses to run outside the grading container (exit 2)', () => {
    const r = fiks(['grade', '--observe', '--require-sandbox']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/sandbox required/);
    const r2 = fiks(['grade', '--observe'], { FIKS_IN_SANDBOX: '1' });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/only inside the grading container/);
  }, 120_000);

  test('a grade without --tools-image is refused before anything runs', () => {
    const r = fiks(['grade', '--pkg', manifestOf('D1'), '--ref', 'A']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--tools-image/);
  }, 120_000);
});

describe('fiks pool', () => {
  test('--primary is identical for the same seed and flags < 3 per class', () => {
    const grades = [
      { patchId: 'a', drift: 'D1', criteria: {}, correct: true, reasons: [] },
      { patchId: 'b', drift: 'D1', criteria: {}, correct: false, reasons: ['hidden'] },
    ];
    writeFileSync(join(tmp, 'grades.json'), JSON.stringify(grades));
    writeFileSync(
      join(tmp, 'drifts.json'),
      JSON.stringify([
        {
          drift: 'D1',
          requestChanging: false,
          grades: 'grades.json',
          candidates: [
            { id: 'a', source: 'refA', generator: 'oracle', diff: join(ORACLES, 'D1.patch') },
            { id: 'b', source: 'P1', generator: 'HOLD-builder', diff: join(DEV, 'pmut/D1/P1.patch') },
          ],
        },
      ]),
    );
    const a = fiks(['pool', '--primary', '--input', join(tmp, 'drifts.json'), '--seed', 'k1']);
    const b = fiks(['pool', '--primary', '--input', join(tmp, 'drifts.json'), '--seed', 'k1']);
    expect(a.status, a.stderr).toBe(0);
    expect(b.stdout).toBe(a.stdout);
    const pool = JSON.parse(a.stdout);
    expect(pool.excluded).toEqual(['D1']);
    expect(pool.hash).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  test('--secondary dedupes and caps', () => {
    const d = join(tmp, 'p.diff');
    writeFileSync(d, readFileSync(join(ORACLES, 'D2.patch'), 'utf8'));
    writeFileSync(
      join(tmp, 'captured.json'),
      JSON.stringify([
        { id: 'x1', drift: 'D2', arm: 'FIKS', diff: 'p.diff' },
        { id: 'x2', drift: 'D2', arm: 'L1', diff: 'p.diff' },
      ]),
    );
    const r = fiks(['pool', '--secondary', '--input', join(tmp, 'captured.json'), '--seed', 's']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).drifts[0].patches).toEqual([
      { id: 'x1', arm: 'FIKS', diffSha: expect.any(String) },
    ]);
  }, 120_000);
});

describe('candidate generation (stub model)', () => {
  test('P1-P8 through MUT prompts, 4 plausible-wrong and 2 alternatives; ref A/B included; no LLM', async () => {
    const p = await loadPackage(manifestOf('D2'));
    const refA = readFileSync(p.refA, 'utf8');
    const seen: CandidateRequest[] = [];
    const { candidates, log } = await generateCandidates(p, {
      repoDir: requireShop(),
      description: 'GET /products/{id} now names the amount field unit_amount.',
      llm: async (req) => {
        seen.push(req);
        return `Here you go:\n\`\`\`diff\n${refA}\`\`\``;
      },
    });
    expect(seen.map((s) => s.kind)).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
      'plausible-wrong',
      'plausible-wrong',
      'plausible-wrong',
      'plausible-wrong',
      'alternative',
      'alternative',
    ]);
    expect(
      seen.filter((s) => s.kind === 'alternative').every((s) => !s.prompt.includes('p.unit_amount')),
    ).toBe(true);
    expect(seen.find((s) => s.kind === 'plausible-wrong')?.prompt).toContain('Reference fix');
    expect(seen.find((s) => s.kind === 'P1')?.model).toBe('claude-haiku-5-5');
    expect(seen.find((s) => s.kind === 'alternative')?.model).toBe('claude-sonnet-5-5');
    expect(candidates.map((c) => c.source)).toContain('refA');
    expect(candidates.map((c) => c.source)).toContain('refB');
    expect(candidates).toHaveLength(16);
    expect(log.every((l) => l.ok)).toBe(true);
  }, 120_000);
});
