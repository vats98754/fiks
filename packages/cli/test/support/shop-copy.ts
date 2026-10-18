import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Recording } from '@fiks/contracts';
import { shopDir } from '../../src/paths.ts';

/** A throwaway copy of the shop-mcp checkout (tracked + untracked files, shared node_modules). */
export function copyShop(): { dir: string; cleanup(): void } {
  const src = shopDir();
  const dir = mkdtempSync(join(tmpdir(), 'fiks-shop-'));
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: src, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const f of files) cpSync(join(src, f), join(dir, f), { recursive: true });
  symlinkSync(join(src, 'node_modules'), join(dir, 'node_modules'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Exact-string source edit; throws if `from` is missing so tests can't silently no-op. */
export function patch(dir: string, file: string, from: string, to: string) {
  const p = join(dir, file);
  const s = readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`patch: ${file} does not contain ${JSON.stringify(from)}`);
  writeFileSync(p, s.replace(from, to));
}

export function writeTrace(dir: string, name: string, rec: Recording, violated: string[], target?: string[]) {
  const mk = (propertyId: string) => ({
    propertyId,
    kind: '',
    path: '',
    expected: '',
    actual: null,
    message: '',
  });
  const p = join(dir, 'test/traces', `${name}.json`);
  writeFileSync(p, `${JSON.stringify({ ...rec, id: name, violated: violated.map(mk), target }, null, 2)}\n`);
  return p;
}

export const readRecording = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Recording;

/** Runs the shop-mcp fiks suites in `dir`. */
export function runSuite(dir: string): { ok: boolean; output: string } {
  const r = spawnSync(join(dir, 'node_modules/.bin/vitest'), ['run', 'test/fiks', '--reporter=verbose'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { ok: r.status === 0, output: `${r.stdout}\n${r.stderr}` };
}

export { dirname };
