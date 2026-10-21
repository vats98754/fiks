import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as I from '@fiks/interfaces';
import { describe, expect, test } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURES = 'packages/cli/test/seed/fixtures';

/** Type names in the PLAN.md Appendix: each "- `Name`" item, plus the prose-named items. */
function appendixNames(): string[] {
  const plan = readFileSync(join(ROOT, 'paper/PLAN.md'), 'utf8');
  const appendix = plan.slice(plan.indexOf('## Appendix: interfaces shared across streams'));
  expect(appendix.length).toBeGreaterThan(100);
  const names = [...appendix.matchAll(/^- `(\w+)`/gm)].map((m) => m[1] as string);
  const prose: Record<string, string[]> = {
    '- CLI command module:': ['CliCommandModule', 'BootstrapModule'],
    '- Contract property (round 6):': ['ContractPropertyDisable'],
  };
  for (const [line, types] of Object.entries(prose)) {
    expect(appendix, `Appendix item "${line}"`).toContain(line);
    names.push(...types);
  }
  // ExecBackend's item also defines ciLocal.
  if (names.includes('ExecBackend')) names.push('CiLocal');
  return names;
}

describe('@fiks/interfaces', () => {
  test('names every Appendix type in the fixture, and the fixture compiles with tsc --noEmit', () => {
    const names = appendixNames();
    expect(names.length).toBeGreaterThanOrEqual(24);
    const fixture = readFileSync(join(ROOT, FIXTURES, 'all-types.ts'), 'utf8');
    const imported = fixture.slice(
      fixture.indexOf('import type {'),
      fixture.indexOf("} from '@fiks/interfaces'"),
    );
    const tuple = fixture.slice(fixture.indexOf('export type AppendixTypes'), fixture.indexOf('];'));
    for (const n of names) {
      expect(imported, `${n} imported from @fiks/interfaces`).toMatch(new RegExp(`\\b${n}\\b`));
      expect(tuple, `${n} named in AppendixTypes`).toMatch(new RegExp(`\\b${n}\\b`));
    }
    const r = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', `${FIXTURES}/tsconfig.json`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 120_000);

  test('RunKey string form round-trips and rejects malformed keys', () => {
    const k = {
      experiment: 'R1',
      arm: 'FIKS',
      model: 'claude-opus-5-5',
      domain: 'shop',
      drift: 'D2',
      attempt: 3,
    };
    expect(I.formatRunKey(k)).toBe('R1/FIKS/claude-opus-5-5/shop/D2/3');
    expect(I.parseRunKey(I.formatRunKey(k))).toEqual(k);
    expect(() => I.formatRunKey({ ...k, model: 'a/b' })).toThrow(/model/);
    expect(() => I.formatRunKey({ ...k, drift: '' })).toThrow(/drift/);
    expect(() => I.formatRunKey({ ...k, attempt: 1.5 })).toThrow(/attempt/);
    for (const bad of [
      'R1/FIKS/m/shop/D2',
      'R1/FIKS/m/shop/D2/x',
      'R1/FIKS/m/shop/D2/1/extra',
      'R1//m/shop/D2/1',
    ]) {
      expect(() => I.parseRunKey(bad), bad).toThrow(/not a RunKey/);
    }
  });

  test('runtime exports are only the name and the RunKey helpers', () => {
    expect(Object.keys(I).sort()).toEqual(['formatRunKey', 'name', 'parseRunKey']);
    expect(I.name).toBe('@fiks/interfaces');
  });
});
