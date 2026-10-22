// The machine-wide mutex used by `~/.fiks/bin/with-lock` (a directory under ~/.fiks/locks/<name>
// holding the owner's pid). Heavy steps (image builds, volume population) take the `docker` lock.
// If an ancestor of this process already holds it (`with-lock docker pnpm tsx build.ts`), the
// caller runs inside that hold instead of waiting for itself.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const lockRoot = () => process.env.FIKS_LOCK_DIR ?? join(homedir(), '.fiks', 'locks');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The pids of this process and its ancestors (via `ps`), nearest first. */
export function ancestry(pid = process.pid): number[] {
  const out: number[] = [];
  let cur = pid;
  for (let i = 0; i < 64 && cur > 1; i++) {
    out.push(cur);
    try {
      const ppid = Number(
        execFileSync('ps', ['-o', 'ppid=', '-p', String(cur)], { encoding: 'utf8' }).trim(),
      );
      if (!Number.isInteger(ppid) || ppid === cur) break;
      cur = ppid;
    } catch {
      break;
    }
  }
  return out;
}

function holder(dir: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export async function withLock<T>(name: string, fn: () => Promise<T>, pollMs = 2000): Promise<T> {
  const root = lockRoot();
  mkdirSync(root, { recursive: true });
  const dir = join(root, name);
  const mine = new Set(ancestry());
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = holder(dir);
      if (pid !== undefined && mine.has(pid)) return fn();
      if (pid !== undefined && !alive(pid)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      await sleep(pollMs);
    }
  }
  writeFileSync(join(dir, 'pid'), String(process.pid));
  try {
    return await fn();
  } finally {
    if (existsSync(dir) && holder(dir) === process.pid) rmSync(dir, { recursive: true, force: true });
  }
}
