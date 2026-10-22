// Stub-agent scripts (SAFE `--agent-stub`) built from an oracle patch: the patch is applied to a
// scratch checkout of the base, and every file it changes becomes one `write` step with the
// patched content, played through the same edit guard as a real agent.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StubSession } from '@fiks/repair';
import { createWorktree } from '@fiks/repro';

export function sessionFromPatch(repo: string, base: string, patch: string, summary?: string): StubSession {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arms-stub-')));
  const wt = createWorktree(repo, base, { dir: join(tmp, 'repo'), linkNodeModules: false });
  try {
    execFileSync('git', ['apply', patch], { cwd: wt.dir });
    const files = execFileSync('git', ['diff', '--name-only'], { cwd: wt.dir, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    return {
      steps: files.map((f) => ({
        op: 'write' as const,
        path: f,
        content: readFileSync(join(wt.dir, f), 'utf8'),
      })),
      summary: summary ?? `Subject: apply ${patch.split('/').pop()}\nScripted oracle patch.`,
    };
  } finally {
    wt.remove();
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function writeScript(file: string, sessions: StubSession[]): string {
  writeFileSync(file, `${JSON.stringify({ sessions }, null, 2)}\n`);
  return file;
}
