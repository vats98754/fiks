// Helpers for the CORE CLI tests: run `fiks` as a subprocess, serialise tests that plant
// temporary command or bootstrap modules, and build an ec241bc tree to compare against.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const ROOT = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '');
export const TSX = join(ROOT, 'node_modules/.bin/tsx');
export const CLI_SRC = join(ROOT, 'packages/cli/src');
export const EC241BC = 'ec241bc';

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `pnpm fiks <args>` (= tsx packages/cli/src/main.ts) from the repo root of `root`. */
export function runCli(
  args: string[],
  opts: { root?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): CliRun {
  const root = opts.root ?? ROOT;
  const r = spawnSync(TSX, [join(root, 'packages/cli/src/main.ts'), ...args], {
    cwd: opts.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialises tests that add temporary files to packages/cli/src/{commands,bootstrap} (they change
 * what every CLI run in the meantime would load). A directory lock in the OS temp dir.
 */
export async function withSrcLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const lock = join(tmpdir(), `fiks-cli-src-${Buffer.from(ROOT).toString('hex').slice(-16)}.lock`);
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (i > 6000) throw new Error(`timed out waiting for ${lock}`);
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The ec241bc USAGE string, read from git at test time. */
export function ec241bcUsage(): string {
  const src = execFileSync('git', ['show', `${EC241BC}:packages/cli/src/main.ts`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const m = /const USAGE = `([\s\S]*?)`;/.exec(src);
  if (!m?.[1]) throw new Error('no USAGE in ec241bc main.ts');
  return m[1];
}

/**
 * The line(s) of an ec241bc-style USAGE string for each command: a two-space entry line plus
 * deeper-indented continuation lines. Independent of the CLI's own extraction.
 */
export function usageByCommand(usage: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const line of usage.split('\n')) {
    const entry = /^ {2}([a-z][a-z-]*)(?:\s|$)/.exec(line);
    if (entry?.[1]) {
      current = entry[1];
      out.set(current, line);
    } else if (current && /^ {3,}\S/.test(line)) {
      out.set(current, `${out.get(current)}\n${line}`);
    } else {
      current = undefined;
    }
  }
  return out;
}

/**
 * A runnable copy of fiks at ec241bc: `git archive` of the commit, with node_modules symlinked so
 * that @fiks/* resolve inside the copy and every other dependency to this checkout's install.
 */
export function ec241bcTree(): { dir: string; cleanup(): void } {
  const base = mkdtempSync(join(tmpdir(), 'fiks-ec241bc-'));
  const dir = join(base, 'fiks');
  mkdirSync(dir);
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${EC241BC} | tar -x -C "${dir}"`]);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  for (const group of ['packages', 'apps']) {
    if (!existsSync(join(dir, group))) continue;
    for (const pkg of readdirSync(join(dir, group))) {
      const cur = join(ROOT, group, pkg, 'node_modules');
      if (!existsSync(cur)) continue;
      linkModules(cur, join(dir, group, pkg, 'node_modules'), dir);
    }
  }
  return { dir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function linkModules(from: string, to: string, tree: string) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (name.startsWith('@') && lstatSync(src).isDirectory() && !lstatSync(src).isSymbolicLink()) {
      linkModules(src, join(to, name), tree);
      continue;
    }
    if (!lstatSync(src).isSymbolicLink()) {
      symlinkSync(realpathSync(src), join(to, name));
      continue;
    }
    const target = resolve(dirname(src), readlinkSync(src));
    const rel = relative(ROOT, target);
    // Workspace packages resolve inside the ec241bc copy (when it has them).
    const inside = !rel.startsWith('..') && /^(packages|apps)\//.test(rel) && existsSync(join(tree, rel));
    symlinkSync(inside ? join(tree, rel) : realpathSync(src), join(to, name));
  }
}
