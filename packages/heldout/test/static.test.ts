// Static check (PLAN 3.0 criterion 5, HOLD acceptance): nothing under packages/heldout/src imports
// @fiks/contracts or @fiks/proxy (by name, subpath or path), directly or through a local relative
// import; and the package's nested Biome rule rejects such an import.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { FIKS_ROOT } from './support/shop.ts';

const SRC = join(FIKS_ROOT, 'packages/heldout/src');
const FORBIDDEN = /^(@fiks\/(contracts|proxy)(\/.*)?|.*\/(contracts|proxy)(\/.*)?)$/;
const SPEC =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.[cm]?[jt]s$/.test(f) ? [p] : [];
  });
}

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(SPEC)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]) as string);
}

describe('no @fiks/contracts or @fiks/proxy under packages/heldout/src', () => {
  test('no specifier names them, and no relative import leaves src into them', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      for (const s of specifiers(f)) {
        if (FORBIDDEN.test(s)) bad.push(`${f}: ${s}`);
        if (s.startsWith('.')) {
          const target = resolve(dirname(f), s);
          if (!target.startsWith(SRC)) bad.push(`${f}: ${s} leaves src`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(files(SRC).length).toBeGreaterThan(10);
  });

  test('grep finds no import of either package in src', () => {
    const r = execFileSync(
      'bash',
      ['-c', `grep -rnE "from '@fiks/(contracts|proxy)|import\\('@fiks/(contracts|proxy)" ${SRC} || true`],
      {
        encoding: 'utf8',
      },
    );
    expect(r.trim()).toBe('');
  });

  test("the package's nested Biome config rejects such an import", () => {
    const probe = join(SRC, `zz-static-probe-${process.pid}.ts`);
    writeFileSync(probe, "import type { Recording } from '@fiks/contracts';\nexport type X = Recording;\n");
    const dir = mkdtempSync(join(tmpdir(), 'fiks-heldout-biome-'));
    try {
      let out = '';
      try {
        out = execFileSync(join(FIKS_ROOT, 'node_modules/.bin/biome'), ['lint', probe], {
          cwd: FIKS_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        out = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`;
      }
      expect(out).toMatch(/noRestrictedImports/);
    } finally {
      rmSync(probe, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
