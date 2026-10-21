// Round-5 Domain hooks are required members of Domain (PLAN P8). A plain .test.ts: the type checks
// run as a spawned tsc, so vitest needs no typecheck mode.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURES = 'packages/cli/test/seed/fixtures';
const tsc = (project: string) =>
  spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', project], { cwd: ROOT, encoding: 'utf8' });

describe('Domain hooks', () => {
  test('hooks-ok.ts compiles and every omission in hooks-missing.ts is a type error', () => {
    const r = tsc(`${FIXTURES}/tsconfig.json`);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const missing = readFileSync(join(ROOT, FIXTURES, 'hooks-missing.ts'), 'utf8');
    expect(missing.match(/^\/\/ @ts-expect-error/gm)).toHaveLength(3);
    expect(missing.match(/^export const \w+: Domain = /gm)).toHaveLength(3);
  }, 120_000);

  test('negative control: hooks-missing.ts without its directives does not compile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fiks-seed-hooks-'));
    try {
      const src = readFileSync(join(ROOT, FIXTURES, 'hooks-missing.ts'), 'utf8');
      const stripped = src.replace(/^\/\/ @ts-expect-error.*\n/gm, '');
      expect(stripped).not.toContain('@ts-expect-error');
      writeFileSync(join(dir, 'hooks-missing.ts'), stripped);
      copyFileSync(join(ROOT, FIXTURES, 'stub.ts'), join(dir, 'stub.ts'));
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          extends: join(ROOT, FIXTURES, 'tsconfig.json'),
          compilerOptions: {
            paths: { '@fiks/interfaces': [join(ROOT, 'packages/interfaces/src/index.ts')] },
          },
          files: ['hooks-missing.ts'],
        }),
      );
      const r = tsc(join(dir, 'tsconfig.json'));
      const out = r.stdout + r.stderr;
      expect(r.status, out).not.toBe(0);
      // Exactly the three omissions, each reported as a missing property.
      for (const hook of ['reproEmitter', 'suite', 'allowedEditPaths']) {
        expect(out).toMatch(new RegExp(`TS2741: Property '${hook}' is missing`));
      }
      expect(out.match(/error TS/g)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('an unused ts-expect-error fails the compile (the directives are load-bearing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fiks-seed-hooks-'));
    try {
      const ok = readFileSync(join(ROOT, FIXTURES, 'hooks-ok.ts'), 'utf8');
      writeFileSync(
        join(dir, 'hooks-ok.ts'),
        ok.replace('export const hooksOk: Domain', '// @ts-expect-error\nexport const hooksOk: Domain'),
      );
      copyFileSync(join(ROOT, FIXTURES, 'stub.ts'), join(dir, 'stub.ts'));
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          extends: join(ROOT, FIXTURES, 'tsconfig.json'),
          compilerOptions: {
            paths: { '@fiks/interfaces': [join(ROOT, 'packages/interfaces/src/index.ts')] },
          },
          files: ['hooks-ok.ts'],
        }),
      );
      const r = tsc(join(dir, 'tsconfig.json'));
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/TS2578: Unused '@ts-expect-error' directive/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
