import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway git repo with one commit. */
export function tempRepo(tag?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-bench-repo-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  if (tag) git('tag', tag);
  return dir;
}
