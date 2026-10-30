// Shared paths and small helpers for `fiks exp-detect` (E-B). Results go to
// bench/results/exp/detect/<runId>/ (FIKS_RESULTS_DIR overrides bench/results, as for summarize).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.ts';

export const detectRoot = () =>
  join(process.env.FIKS_RESULTS_DIR ?? join(ROOT, 'bench/results'), 'exp/detect');

/** `20261030T174501Z` (UTC, second precision). */
export const newRunId = (d = new Date()) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

export const jsonl = (rows: unknown[]) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

export function readJsonl<T = Record<string, unknown>>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** The newest run directory under `root` that holds `file`, or undefined. */
export function latestRunWith(root: string, file: string): string | undefined {
  if (!existsSync(root)) return undefined;
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, file)))
    .sort()
    .at(-1);
}

export function gitHead(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** Tracked changes only: untracked run outputs under bench/results do not make the code dirty. */
export function gitDirty(dir: string): boolean | null {
  try {
    return (
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim() !== ''
    );
  } catch {
    return null;
  }
}

/** E-B makes no model call: refuse any that a dependency might attempt (@fiks/llm honours this). */
export function forbidLlm(): void {
  process.env.FIKS_LLM_FORBID = '1';
}
