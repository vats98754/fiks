// The dev DriftPackages (D1-D5 on seed-v1, DEV-X1 on base-shop) are complete, valid and
// regenerate byte-identically; every hand-written P1-P8 patch applies to its base and has a
// committed expected GradeRecord; the frozen traces and fiks/agent test sets regenerate too.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDriftPackage } from '@fiks/injector';
import type { GradeRecord } from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';
import { buildAll } from '../src/dev/build.ts';
import { prepareHead } from '../src/head.ts';
import { loadPackage } from '../src/pkg.ts';
import { DEV, FIKS_ROOT, manifestOf, requireShop } from './support/shop.ts';

const IDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'DEV-X1'];
const OPS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

describe('dev DriftPackages', () => {
  test('generated files (hidden tests, renamed variants, manifests) regenerate byte-identically', async () => {
    expect((await buildAll({ check: true })).changed).toEqual([]);
  }, 120_000);

  for (const id of [...IDS, 'TRK-DEV-1']) {
    test(`${id}: a complete, valid DriftPackage with >= 3 hidden tests and a renamed-id variant`, async () => {
      const v = await validateDriftPackage(manifestOf(id), { complete: true });
      expect(v.errors).toEqual([]);
      const p = await loadPackage(manifestOf(id));
      expect(p.hidden.length).toBeGreaterThanOrEqual(3);
      expect(p.renamed.map((h) => h.name).sort()).toEqual(p.hidden.map((h) => h.name).sort());
      expect(p.generators.length).toBeGreaterThan(0);
      expect(existsSync(join(DEV, id, 'trace.json'))).toBe(true);
      const trace = JSON.parse(readFileSync(join(DEV, id, 'trace.json'), 'utf8'));
      expect(trace.profile).toEqual({
        domain: p.pkg.domain,
        base: 'v1',
        ruleId: p.rule.id,
        ruleHash: p.rule.hash,
      });
      expect(trace.target).toHaveLength(1);
      expect(readdirSync(join(DEV, id, 'fiks/test/repro')).sort()).toEqual([
        `${trace.id}.json`,
        `${trace.id}.test.ts`,
      ]);
      expect(readdirSync(join(DEV, id, 'agent/test'))).toEqual([`agent-${trace.id}.test.ts`]);
    });
  }

  for (const id of IDS) {
    test(`${id}: ref A, ref B and P1-P8 apply to ${id === 'DEV-X1' ? 'base-shop' : 'seed-v1'}; each P has an expected GradeRecord`, async () => {
      const shop = requireShop();
      const p = await loadPackage(manifestOf(id));
      const patches = [p.refA, p.refB, ...OPS.map((o) => join(DEV, 'pmut', id, `${o}.patch`))];
      for (const f of patches) {
        const h = prepareHead(shop, p.pkg.base, readFileSync(f, 'utf8'));
        try {
          expect(h.applied, `${f}: ${h.error}`).toBe(true);
        } finally {
          h.remove();
        }
      }
      for (const o of OPS) {
        const e = JSON.parse(
          readFileSync(join(DEV, 'pmut', id, `${o}.expected.json`), 'utf8'),
        ) as GradeRecord;
        expect(e.patchId).toBe(`${id}/${o}`);
        expect(e.drift).toBe(id);
        expect(e.correct).toBe(e.reasons.length === 0);
      }
      // P3 special-cases the recorded id: expected to fail the renamed-id variant.
      expect(
        (JSON.parse(readFileSync(join(DEV, 'pmut', id, 'P3.expected.json'), 'utf8')) as GradeRecord).reasons,
      ).toContain('renamed-id');
    }, 120_000);
  }

  test('D1 P1 (clamp) is expected incorrect', () => {
    const e = JSON.parse(readFileSync(join(DEV, 'pmut/D1/P1.expected.json'), 'utf8')) as GradeRecord;
    expect(e.correct).toBe(false);
  });

  test('frozen traces, enumerations and the fiks/agent test sets regenerate byte-identically', () => {
    // Runs each drift's base (never a candidate) under vendor v1 + the rule and under v1.
    const out = execFileSync(
      join(FIKS_ROOT, 'node_modules/.bin/tsx'),
      ['packages/cli/src/main.ts', 'grade', 'dev-traces', '--check'],
      {
        cwd: FIKS_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(out.trim()).toBe('');
  }, 900_000);
});
