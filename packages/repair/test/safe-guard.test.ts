// SAFE: realpath read guard (P2), strict quarantine (P3), edit guard from allowedEditPaths (P8).
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ALLOWED_EDIT_PATHS,
  editGuard,
  escapingSymlinks,
  mayGlob,
  mayRead,
  maySearch,
  mayWrite,
  REPAIR_ALLOWED,
} from '../src/index.ts';

/** A temp tree: <root>/.env (a secret) and <root>/wt (the worktree) with the usual layout. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'fiks-safe-'));
  const wt = join(root, 'wt');
  for (const d of ['src', 'test/fixtures/v1', 'test/repro', 'test/traces', 'test/fiks', '.alerts']) {
    mkdirSync(join(wt, d), { recursive: true });
  }
  writeFileSync(join(root, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN=secret\n');
  for (const f of [
    'src/a.ts',
    'test/fixtures/v1/a.json',
    'test/repro/x.json',
    'test/repro/x.test.ts',
    'test/traces/t.json',
    'test/fiks/replay.ts',
    '.alerts/a.json',
  ]) {
    writeFileSync(join(wt, f), '{}');
  }
  return { root, wt };
}

describe('mayRead: realpath containment', () => {
  test('a symlink src/x.ts -> ../../.env inside a temp worktree is refused', () => {
    const { wt } = tree();
    symlinkSync('../../.env', join(wt, 'src/x.ts'));
    expect(mayRead(wt, 'src/x.ts')).toBe(false);
    expect(mayRead(wt, join(wt, 'src/x.ts'))).toBe(false);
    // the realpath form of the worktree (macOS /var -> /private/var) is the same file
    expect(mayRead(realpathSync(wt), 'src/x.ts')).toBe(false);
    expect(mayRead(wt, 'src/a.ts')).toBe(true);
  });

  test('a .. escape is refused', () => {
    const { root, wt } = tree();
    expect(mayRead(wt, '../.env')).toBe(false);
    expect(mayRead(wt, 'src/../../.env')).toBe(false);
    expect(mayRead(wt, join(root, '.env'))).toBe(false);
    expect(mayRead(wt, 'src/../src/a.ts')).toBe(true);
  });

  test('a symlinked directory and a dangling link are refused; a link inside the worktree is fine', () => {
    const { root, wt } = tree();
    symlinkSync(root, join(wt, 'src/up'));
    symlinkSync('../nowhere/x', join(wt, 'src/dangling.ts'));
    symlinkSync('a.ts', join(wt, 'src/alias.ts'));
    expect(mayRead(wt, 'src/up/.env')).toBe(false);
    expect(mayRead(wt, 'src/dangling.ts')).toBe(false);
    expect(mayRead(wt, 'src/alias.ts')).toBe(true);
    expect(escapingSymlinks(wt)).toEqual(['src/dangling.ts -> ../nowhere/x', `src/up -> ${root}`]);
  });

  test('a not-yet-existing path inside the worktree is readable (e.g. a Glob root)', () => {
    const { wt } = tree();
    expect(mayRead(wt, 'src/new/dir')).toBe(true);
    expect(mayRead(wt, undefined)).toBe(true);
  });

  test('Glob patterns may not climb out; Grep roots are contained too', () => {
    const { root, wt } = tree();
    expect(mayGlob(wt, '**/*.ts')).toBe(true);
    expect(mayGlob(wt, '../**/.env')).toBe(false);
    expect(mayGlob(wt, `${root}/**`)).toBe(false);
    expect(mayGlob(wt, `${wt}/src/**/*.ts`)).toBe(true);
    expect(maySearch(wt, '..')).toBe(false);
    expect(maySearch(wt, undefined)).toBe(true);
  });
});

describe('strict quarantine (E6) vs raw', () => {
  test('in strict mode, Read of fixtures, repro json, traces and alerts is denied', () => {
    const { wt } = tree();
    const strict = { traceFormat: 'strict' as const };
    for (const f of [
      'test/fixtures/v1/a.json',
      'test/repro/x.json',
      'test/traces/t.json',
      '.alerts/a.json',
    ]) {
      expect(mayRead(wt, f, strict), f).toBe(false);
      expect(mayRead(wt, join(wt, f), strict), f).toBe(false);
    }
    // case and symlink aliases do not get around it
    expect(mayRead(wt, 'TEST/Fixtures/v1/a.json', strict)).toBe(false);
    symlinkSync('../test/traces/t.json', join(wt, 'src/t.json'));
    expect(mayRead(wt, 'src/t.json', strict)).toBe(false);
    // what stays readable
    for (const f of ['src/a.ts', 'test/fiks/replay.ts', 'test/repro/x.test.ts']) {
      expect(mayRead(wt, f, strict), f).toBe(true);
    }
  });

  test('in raw mode .alerts/a.json and test/fiks/replay.ts are allowed (every arm needs them)', () => {
    const { wt } = tree();
    for (const f of [
      '.alerts/a.json',
      'test/fiks/replay.ts',
      'test/fixtures/v1/a.json',
      'test/repro/x.json',
    ]) {
      expect(mayRead(wt, f), f).toBe(true);
      expect(mayRead(wt, f, { traceFormat: 'raw' }), f).toBe(true);
    }
  });

  test('a strict-mode content search may not cover a quarantined directory', () => {
    const { wt } = tree();
    const strict = { traceFormat: 'strict' as const };
    for (const p of [undefined, '.', 'test', 'test/fixtures', 'test/repro', '.alerts']) {
      expect(maySearch(wt, p, strict), String(p)).toBe(false);
    }
    for (const p of ['src', 'test/fiks']) expect(maySearch(wt, p, strict), p).toBe(true);
    expect(maySearch(wt, 'test')).toBe(true);
  });
});

describe('edit guard from allowedEditPaths', () => {
  test("with ['^apps/[^/]+/src/.+\\.ts$'] apps/x/src/a.ts is allowed and src/a.ts is refused", () => {
    const { wt } = tree();
    const policy = { allowedEditPaths: ['^apps/[^/]+/src/.+\\.ts$'] };
    expect(mayWrite(wt, 'apps/x/src/a.ts', policy)).toBe(true);
    expect(mayWrite(wt, join(wt, 'apps/x/src/deep/b.ts'), policy)).toBe(true);
    expect(mayWrite(wt, 'src/a.ts', policy)).toBe(false);
    expect(mayWrite(wt, 'apps/x/test/a.ts', policy)).toBe(false);
  });

  test("with no option the guard equals today's REPAIR_ALLOWED (/^src\\/.+\\.ts$/)", () => {
    const today = (f: string) => /^src\/.+\.ts$/.test(f);
    expect(DEFAULT_ALLOWED_EDIT_PATHS).toEqual(['^src/.+\\.ts$']);
    const guard = editGuard();
    for (const f of [
      'src/a.ts',
      'src/tools/get_product.ts',
      'src/a.tsx',
      'src/.ts',
      'src/x.ts.bak',
      'test/a.ts',
      'xsrc/a.ts',
      'apps/x/src/a.ts',
      'package.json',
      'src/a.json',
      '.github/workflows/ci.yml',
    ]) {
      expect(guard(f), f).toBe(today(f));
      expect(REPAIR_ALLOWED(f), f).toBe(today(f));
    }
    const { wt } = tree();
    expect(mayWrite(wt, 'src/a.ts')).toBe(true);
    expect(mayWrite(wt, 'test/fiks/replay.ts')).toBe(false);
  });

  test('a symlink cannot launder a write: src/x.ts -> ../test/fiks/replay.ts or -> ../../.env', () => {
    const { wt } = tree();
    symlinkSync('../test/fiks/replay.ts', join(wt, 'src/x.ts'));
    symlinkSync('../../.env', join(wt, 'src/y.ts'));
    expect(mayWrite(wt, 'src/x.ts')).toBe(false);
    expect(mayWrite(wt, 'src/y.ts')).toBe(false);
  });
});
