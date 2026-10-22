import { execFileSync } from 'node:child_process';

/**
 * Output folders that never make a run "dirty": bench logs and paper run outputs are written by
 * runs, not code changes (PLAN 7.1 run outputs). Everything else counts, untracked files included.
 */
export const RUN_OUTPUT_PATHS = ['bench/results', 'bench/evidence', 'paper/results/raw'];

/** `git status --porcelain` lines of `root`, minus the run-output folders. */
export function dirtyPaths(root: string, ignore: readonly string[] = RUN_OUTPUT_PATHS): string[] {
  const out = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', '.', ...ignore.map((p) => `:(exclude)${p}`)],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  );
  return out.split('\n').filter(Boolean);
}

export class DirtyTreeError extends Error {
  constructor(
    readonly root: string,
    readonly paths: string[],
  ) {
    const shown = paths.slice(0, 10).join('\n  ');
    const more = paths.length > 10 ? `\n  ... and ${paths.length - 10} more` : '';
    super(
      `refusing to start: the fiks tree at ${root} has uncommitted changes, so meta.json could not name the code that ran (PLAN 7). Commit or stash them, or pass --allow-dirty for a scratch run.\n  ${shown}${more}`,
    );
    this.name = 'DirtyTreeError';
  }
}

/** Throws `DirtyTreeError` unless `root` is clean outside the run-output folders. */
export function assertCleanTree(root: string, ignore?: readonly string[]): void {
  const paths = dirtyPaths(root, ignore);
  if (paths.length) throw new DirtyTreeError(root, paths);
}
