// Helpers for the runner's CLI tests: a temp HOME, a clean temp git tree for the guards
// (FIKS_EXP_REPO), the stub fiks bin, and a spawn wrapper around `tsx src/main.ts`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
export const MAIN = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
export const STUB = fileURLToPath(new URL('./stub-fiks.mjs', import.meta.url));
export const STUB_LLM = fileURLToPath(new URL('./stub-llm.ts', import.meta.url));

export function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `fiks-exp-${prefix}-`));
}

/** A clean git repo for the dirty-tree guard and the frozen commit. */
export function cleanRepo(): string {
  const dir = tmp('tree');
  const git = (...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'exp-test@example.invalid');
  git('config', 'user.name', 'exp test');
  writeFileSync(join(dir, 'README'), 'tree\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

export interface Env {
  home: string;
  tree: string;
  out: string;
  log: string;
  state: string;
  env: Record<string, string>;
}

export function makeEnv(extra: Record<string, string> = {}): Env {
  const home = tmp('home');
  mkdirSync(join(home, '.fiks'), { recursive: true });
  const tree = cleanRepo();
  const out = tmp('out');
  const log = join(tmp('log'), 'calls.jsonl');
  const state = tmp('state');
  return {
    home,
    tree,
    out,
    log,
    state,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      FIKS_EXP_REPO: tree,
      FIKS_EXP_FIKS_BIN: JSON.stringify([process.execPath, STUB]),
      FIKS_EXP_TSX_BIN: JSON.stringify([process.execPath, STUB]),
      FIKS_EXP_PREFLIGHT_CMD: JSON.stringify([process.execPath, '-e', 'process.exit(0)']),
      STUB_LOG: log,
      STUB_STATE: state,
      ...extra,
    },
  };
}

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], env: Record<string, string>, timeoutMs = 120_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [MAIN, ...args], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Starts the CLI in its own process group (so the test can kill -9 the whole tree). */
export function startCli(args: string[], env: Record<string, string>) {
  const child = spawn(TSX, [MAIN, ...args], {
    env,
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += String(d);
  });
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  return { child, exited, out: () => ({ stdout, stderr }) };
}

export function readJsonl<T = Record<string, unknown>>(file: string): T[] {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
