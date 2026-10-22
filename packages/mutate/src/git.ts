// Reads BASE sources for mutatePatch from a git repository (no checkout, no fetch).
import { execFileSync } from 'node:child_process';
import { diffFiles } from './diff.ts';

/** path -> content at `ref` for every file `diff` touches (plus `extra` paths). */
export function baseFilesAt(
  repoDir: string,
  ref: string,
  diff: string,
  extra: string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of [...new Set([...diffFiles(diff), ...extra])].sort()) {
    out[path] = execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: repoDir,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  return out;
}
