// Runs one arm/step subprocess: its own process group (so an abort or a resume can kill the whole
// tree), its own FIKS_DIR, output to a log file only (nothing reaches the status output), a hard
// timeout, and a pid file so a resume after `kill -9` can kill orphans of the previous session.

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finished } from './classify.ts';

export interface ChildSpec {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  /** Folder of this try: output.txt, fiks/ (FIKS_DIR) and the pid file live here. */
  dir: string;
  timeoutMs: number;
  /** Pid files of live children (<runDir>/pids). */
  pidDir: string;
}

export interface RunningChild {
  done: Promise<Finished>;
  kill(): void;
}

const TAIL_BYTES = 8192;

function tailOf(file: string): string {
  try {
    const size = statSync(file).size;
    const buf = readFileSync(file);
    return buf.subarray(Math.max(0, size - TAIL_BYTES)).toString('utf8');
  } catch {
    return '';
  }
}

export function killGroup(pid: number, sig: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  }
}

export function startChild(s: ChildSpec): RunningChild {
  const fiksDir = join(s.dir, 'fiks');
  mkdirSync(fiksDir, { recursive: true });
  mkdirSync(s.pidDir, { recursive: true });
  const log = join(s.dir, 'output.txt');
  const fd = openSync(log, 'a');
  const [cmd, ...args] = s.argv;
  let spawnError: string | null = null;
  let timedOut = false;
  const child = spawn(cmd as string, args, {
    cwd: s.cwd,
    env: { ...s.env, FIKS_DIR: fiksDir },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  closeSync(fd);
  const pidFile = child.pid ? join(s.pidDir, String(child.pid)) : null;
  if (pidFile)
    writeFileSync(pidFile, `${JSON.stringify({ pid: child.pid, dir: s.dir, argv: s.argv.slice(0, 12) })}\n`);
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) killGroup(child.pid, 'SIGTERM');
    setTimeout(() => child.pid && killGroup(child.pid, 'SIGKILL'), 10_000).unref();
  }, s.timeoutMs);
  timer.unref();
  const done = new Promise<Finished>((resolve) => {
    let settled = false;
    const finish = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Reap anything the command left behind in its process group.
      if (child.pid) killGroup(child.pid, 'SIGKILL');
      if (pidFile) rmSync(pidFile, { force: true });
      resolve({ exitCode: code, signal, spawnError, timedOut, tail: tailOf(log), fiksDir });
    };
    child.on('error', (e) => {
      spawnError = e.message;
      finish(null, null);
    });
    child.on('exit', (code, signal) => finish(code, signal));
  });
  return {
    done,
    kill: () => {
      if (child.pid) killGroup(child.pid, 'SIGKILL');
    },
  };
}
