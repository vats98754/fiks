// The injector is built without reading contracts (PLAN 5.2): no file in the package mentions the
// contracts or proxy packages, and a Biome rule rejects such an import.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PKG, '../..');
// Spelled in two parts so this file does not contain the names it forbids.
const FORBIDDEN = ['contracts', 'proxy'].map((n) => `@fiks/${n}`);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/**
 * Lints `source` as repo path `path` under the real root and injector Biome configs, copied into a
 * temp tree (Biome's stdin mode prints no diagnostics, and probes must not touch the source tree).
 */
function lint(path: string, source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-injector-lint-'));
  try {
    cpSync(join(ROOT, 'biome.json'), join(dir, 'biome.json'));
    mkdirSync(join(dir, 'packages/injector'), { recursive: true });
    cpSync(join(PKG, 'biome.json'), join(dir, 'packages/injector/biome.json'));
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
    return spawnSync(join(ROOT, 'node_modules/.bin/biome'), ['lint', '--vcs-enabled=false', path], {
      cwd: dir,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('contract isolation', () => {
  test('no file in packages/injector names the contracts or proxy packages', () => {
    const hits = files(PKG).filter((f) => {
      const text = readFileSync(f, 'utf8');
      return FORBIDDEN.some((n) => text.includes(n));
    });
    expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
  });

  test.each([
    `import { SHOP_CONTRACTS } from '${FORBIDDEN[0]}';\nexport const x = SHOP_CONTRACTS;\n`,
    `import type { Receipt } from '${FORBIDDEN[1]}';\nexport type X = Receipt;\n`,
    `export { startProxy } from '${FORBIDDEN[1]}/src/index.ts';\n`,
    `import { evaluate } from '../../${'contracts'}/src/index.ts';\nexport const x = evaluate;\n`,
  ])('the lint rule rejects %s', (source) => {
    const r = lint('packages/injector/src/probe.ts', source);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('noRestrictedImports');
  });

  test('the same import is allowed outside packages/injector (the rule is scoped)', () => {
    const r = lint(
      'packages/cli/src/probe.ts',
      `import { x } from '${FORBIDDEN[0]}';\nexport const y = x;\n`,
    );
    expect(`${r.stdout}${r.stderr}`).not.toContain('noRestrictedImports');
  });

  test('a normal injector import passes the lint rule', () => {
    const r = lint(
      'packages/injector/src/probe.ts',
      `import { startInjector } from './injector.ts';\nexport const s = startInjector;\n`,
    );
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });
});
