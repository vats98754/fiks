// The host side of the git push shim (PLAN P4): a `git` placed first on PATH for every process of a
// run. Pushes are recorded in a JSONL log and refused; everything else goes to the real git. The same
// script is baked into the sandbox images (docker/git-shim.sh). Acceptance = zero pushes in the log.
// It blocks push, send-pack and http-push spelled directly, through -c/--config-env, or through an
// alias from any config source (repo/global/system config, include.path, GIT_CONFIG_COUNT/KEY_n/VALUE_n,
// GIT_CONFIG_PARAMETERS), following alias chains; a '!' shell alias that mentions push is blocked too.
// Limits of any PATH shim: a process that runs the real git by absolute path (/usr/bin/git,
// /opt/homebrew/bin/git) bypasses it, and so does `git` run from a hook or from a script a shell alias
// starts, because git prepends its exec-path (which holds the real `git`) to PATH for those children.
// The shim is the audit log; the enforcement in the sandbox is --network none (no remote is reachable).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { type PushRecord, parsePushLog } from './backend.ts';
import { DOCKER_DIR } from './build.ts';

const shq = (s: string) => s.replace(/'/g, `'\\''`);

/** The first `git` on PATH that is not a fiks shim. */
export function realGit(path = process.env.PATH ?? ''): string {
  for (const dir of path.split(delimiter)) {
    const p = join(dir, 'git');
    if (!dir || !existsSync(p)) continue;
    try {
      if (readFileSync(p, 'utf8').includes('fiks git shim')) continue;
    } catch {
      // A binary we cannot read as text is a real git.
    }
    return p;
  }
  throw new Error('no git found on PATH');
}

export function shimScript(logPath: string, gitPath: string): string {
  return readFileSync(join(DOCKER_DIR, 'git-shim.sh'), 'utf8')
    .replace('@@FIKS_SHIM_LOG@@', shq(logPath))
    .replace('@@FIKS_REAL_GIT@@', shq(gitPath));
}

export interface GitShim {
  /** Directory holding `git`; prepend it to PATH. */
  binDir: string;
  logPath: string;
  /** `PATH` with the shim first. */
  path: string;
  pushes(): PushRecord[];
}

export function installGitShim(binDir: string, logPath: string, opts: { realGit?: string } = {}): GitShim {
  const gitPath = opts.realGit ?? realGit();
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dirname(logPath), { recursive: true });
  const file = join(binDir, 'git');
  writeFileSync(file, shimScript(logPath, gitPath));
  chmodSync(file, 0o755);
  // Fail early if the shell cannot run it.
  execFileSync('sh', ['-n', file]);
  return {
    binDir,
    logPath,
    path: [binDir, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    pushes: () => readPushLog(logPath),
  };
}

export function readPushLog(logPath: string): PushRecord[] {
  return existsSync(logPath) ? parsePushLog(readFileSync(logPath, 'utf8')) : [];
}
