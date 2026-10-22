// The injector is built without reading contracts (PLAN 5.2): no file in the package mentions the
// contracts or proxy packages, and a Biome rule rejects such an import.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PKG, '../..');
// Spelled in parts so this file does not contain the names or paths it forbids.
const [C, P] = ['contracts', 'proxy'];
const FORBIDDEN = [C, P].map((n) => `@fiks/${n}`);
const FORBIDDEN_DIRS = [C, P].map((n) => `packages/${n}/`);

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

function statSafe(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
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

  // [repo path of the probe, source]. Covers every depth inside the package (the package root,
  // src/, src/transforms/ where drift logic lives), `import type`, re-exports, side-effect and
  // dynamic imports, and absolute paths; the rule is depth-independent (any contract*/prox* segment).
  test.each([
    [
      'packages/injector/src/probe.ts',
      `import { SHOP_CONTRACTS } from '${FORBIDDEN[0]}';\nexport const x = SHOP_CONTRACTS;\n`,
    ],
    [
      'packages/injector/src/probe.ts',
      `import type { Receipt } from '${FORBIDDEN[1]}';\nexport type X = Receipt;\n`,
    ],
    ['packages/injector/src/probe.ts', `export { startProxy } from '${FORBIDDEN[1]}/src/index.ts';\n`],
    [
      'packages/injector/src/probe.ts',
      `import { evaluate } from '../../${C}/src/index.ts';\nexport const x = evaluate;\n`,
    ],
    ['packages/injector/src/probe.ts', `export const f = () => import('${FORBIDDEN[0]}');\n`],
    [
      'packages/injector/src/transforms/probe.ts',
      `import { X } from '../../../${C}/src/index.ts';\nexport const y = X;\n`,
    ],
    [
      'packages/injector/src/transforms/probe.ts',
      `import type { X } from '../../../${C}/src/index.ts';\nexport type Y = X;\n`,
    ],
    [
      'packages/injector/src/transforms/probe.ts',
      `import type { X } from '../../../${P}/src/proxy.ts';\nexport type Y = X;\n`,
    ],
    ['packages/injector/src/transforms/probe.ts', `export type { X } from '../../../${C}/src/index.ts';\n`],
    ['packages/injector/src/transforms/probe.ts', `import '../../../${P}/src/index.ts';\n`],
    [
      'packages/injector/src/transforms/probe.ts',
      `export const f = () => import('../../../${C}/src/index.ts');\n`,
    ],
    [
      'packages/injector/src/transforms/probe.ts',
      `import type { X } from '../../../../packages/${C}/src/index.ts';\nexport type Y = X;\n`,
    ],
    [
      'packages/injector/src/transforms/probe.ts',
      `import type { X } from '/repo/packages/${P}/src/index.ts';\nexport type Y = X;\n`,
    ],
    ['packages/injector/probe.ts', `import { X } from '../${C}/src/index.ts';\nexport const y = X;\n`],
    ['packages/injector/probe.ts', `import type { X } from '../${P}';\nexport type Y = X;\n`],
    [
      'packages/injector/test/probe.ts',
      `import type { X } from '../../${C}/src/index.ts';\nexport type Y = X;\n`,
    ],
  ])('the lint rule rejects, at %s: %s', (path, source) => {
    const r = lint(path, source);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('noRestrictedImports');
  });

  // Biome's rule matches specifier text, so it cannot see `require` calls or a path that differs only
  // in letter case (which resolves on a case-insensitive file system). This check resolves every
  // relative or absolute string literal in the package instead, and follows relative imports out of
  // the package (e.g. into packages/interfaces) to their transitive closure.
  test('no string in the package resolves into the contracts or proxy packages, even transitively', () => {
    const SPEC_RE = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])([^'"\n]+)\1/g;
    const LITERAL_RE = /(['"])([^'"\n]*)\1/g;
    const isPathLike = (s: string) => s.startsWith('.') || s.startsWith('/');
    const real = (p: string) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    const inForbidden = (abs: string) => {
      const rel = relative(ROOT, real(abs)).toLowerCase();
      return FORBIDDEN_DIRS.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
    };
    const hits: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const f of files(PKG).filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
      for (const [, , lit = ''] of readFileSync(f, 'utf8').matchAll(LITERAL_RE)) {
        if (!isPathLike(lit)) continue;
        const target = resolve(dirname(f), lit);
        if (inForbidden(target)) hits.push(`${relative(ROOT, f)} -> ${lit}`);
        else if (!real(target).startsWith(real(PKG)) && statSafe(target)) queue.push(real(target));
      }
    }
    // Files outside the package reached by a relative import: check their own imports transitively.
    while (queue.length > 0) {
      const f = queue.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const [, , spec = ''] of readFileSync(f, 'utf8').matchAll(SPEC_RE)) {
        if (FORBIDDEN.some((n) => spec === n || spec.startsWith(`${n}/`))) {
          hits.push(`${relative(ROOT, f)} -> ${spec}`);
        } else if (isPathLike(spec)) {
          const target = resolve(dirname(f), spec);
          if (inForbidden(target)) hits.push(`${relative(ROOT, f)} -> ${spec}`);
          else if (statSafe(target)) queue.push(real(target));
        }
      }
    }
    expect(hits).toEqual([]);
    // Not vacuous: the shared drift types are reached and walked.
    expect([...seen].map((f) => relative(ROOT, f))).toContain('packages/interfaces/src/drift.ts');
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
