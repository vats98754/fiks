// Static checks (DET acceptance): packages/frame/src computes no verdict, and the truth() label
// files never depend on the contracts or the proxy; tests never write run outputs.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT } from './support/cli.ts';

const SRC = join(ROOT, 'packages/frame/src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

/** Every import/export-from statement of a file: [specifier, statement]. */
function imports(file: string): [string, string][] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => [
    m[1] as string,
    m[0],
  ]);
}

test('no file under packages/frame/src imports evaluate, checkInvariant or @fiks/proxy', () => {
  expect(files.length).toBeGreaterThan(5);
  const allowed = new Set(['fpCapability', 'propertyFamily']);
  for (const f of files) {
    const text = readFileSync(join(SRC, f), 'utf8');
    expect(text, f).not.toMatch(/\bcheckInvariant\b/);
    expect(text, f).not.toMatch(/\bevaluate\s*\(/);
    for (const [spec, stmt] of imports(f)) {
      expect(spec, f).not.toMatch(/proxy/);
      expect(spec, f).not.toMatch(/contracts\/src\/evaluate/);
      if (spec === '@fiks/contracts' && !/^\s*import\s+type\b/.test(stmt)) {
        const names = [...stmt.matchAll(/(?:^|[{,])\s*(type\s+)?(\w+)/g)]
          .filter((m) => !m[1])
          .map((m) => m[2] as string)
          .filter((n) => !['import', 'from'].includes(n));
        for (const n of names) expect(allowed.has(n), `${f} imports ${n} from @fiks/contracts`).toBe(true);
      }
    }
  }
});

test('no file under packages/frame/src/label* imports @fiks/contracts or @fiks/proxy', () => {
  const labels = files.filter((f) => f.startsWith('label'));
  expect(labels.length).toBeGreaterThan(0);
  for (const f of labels) {
    for (const [spec] of imports(f)) expect(spec, f).not.toMatch(/@fiks\/(contracts|proxy)|contracts|proxy/);
  }
});

test('git status --porcelain paper/results is empty', () => {
  const out = execFileSync('git', ['status', '--porcelain', 'paper/results'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(out).toBe('');
});
