// Stub-agent scripts for the FIKS arm tests (SAFE stub runner, zero LLM calls): an oracle patch
// becomes `write` steps with the patched file contents, computed on a scratch checkout of `ref`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StubScript, StubSession } from '@fiks/repair';

/** One session whose steps write the files `patch` changes, as they are after `git apply` on `ref`. */
export function sessionFromPatch(repo: string, ref: string, patch: string, summary?: string): StubSession {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-stub-'));
  try {
    execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', join(dir, 'wt'), `${ref}^{commit}`],
      {
        cwd: repo,
        stdio: 'pipe',
      },
    );
    const wt = join(dir, 'wt');
    execFileSync('git', ['apply', patch], { cwd: wt });
    const files = execFileSync('git', ['diff', '--name-only'], { cwd: wt, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    return {
      steps: files.map((f) => ({
        op: 'write' as const,
        path: f,
        content: readFileSync(join(wt, f), 'utf8'),
      })),
      summary: summary ?? `Subject: apply the reference fix\nApplied ${patch.split('/').pop()} (test stub).`,
    };
  } finally {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', join(dir, 'wt')], { cwd: repo, stdio: 'pipe' });
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

export const script = (...sessions: StubSession[]): StubScript => ({ sessions });
