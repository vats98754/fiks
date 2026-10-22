// Runs `pnpm fiks <args>` (packages/cli/src/main.ts through tsx) as a subprocess.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
export const TSX = join(ROOT, 'node_modules/.bin/tsx');
export const MAIN = join(ROOT, 'packages/cli/src/main.ts');
export const SHOP_CLONE = join(ROOT, '.work/shop-mcp');
export const PY = join(ROOT, 'paper/.venv/bin/python');

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export function fiks(args: string[], env: Record<string, string> = {}): Run {
  const r = spawnSync(TSX, [MAIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** Like `fiks`, but throws with the output unless the exit code is 0. */
export function fiksOk(args: string[], env: Record<string, string> = {}): Run {
  const r = fiks(args, env);
  if (r.code !== 0) throw new Error(`fiks ${args.join(' ')} exited ${r.code}\n${r.stdout}\n${r.stderr}`);
  return r;
}

export function run(cmd: string, args: string[], env: Record<string, string> = {}, cwd = ROOT): Run {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

export const tmp = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), `fiks-det-${prefix}-`)));

export const readLines = <T = Record<string, unknown>>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

export const readJson = <T = Record<string, unknown>>(file: string): T =>
  JSON.parse(readFileSync(file, 'utf8')) as T;

/** A detached worktree of the shop-mcp clone at `ref` (node_modules linked); `edit` may change it. */
export function shopWorktree(ref: string): { dir: string; remove(): void } {
  const parent = tmp('wt');
  const dir = join(parent, 'shop');
  execFileSync('git', ['-C', SHOP_CLONE, 'worktree', 'add', '--detach', dir, `${ref}^{commit}`], {
    stdio: 'pipe',
  });
  symlinkSync(realpathSync(join(SHOP_CLONE, 'node_modules')), join(dir, 'node_modules'));
  return {
    dir,
    remove() {
      try {
        execFileSync('git', ['-C', SHOP_CLONE, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' });
      } catch {
        // already gone
      }
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

/** Commits every change in a worktree (no hooks, fixed identity). */
export function commitAll(dir: string, message: string): string {
  const git = (...a: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=fiks-test',
        '-c',
        'user.email=test@fiks.invalid',
        ...a,
      ],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD').trim();
}
