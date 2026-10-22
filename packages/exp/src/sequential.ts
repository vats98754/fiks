// Sequential steps (command runs and the prepare phase of block runs): each step is a subprocess
// with its own FIKS_DIR and log; a completed step is skipped on resume; a cap pauses the run; any
// other failure stops it (the step is re-run on the next start).

import { join } from 'node:path';
import { startChild } from './child.ts';
import { classifyAttempt } from './classify.ts';
import type { Registry, RegistryState } from './registry.ts';
import type { CommandStep } from './runs.ts';

export type StepsEnd =
  | { state: 'complete' }
  | { state: 'paused'; reason: 'cap'; resetAt: string | null }
  | { state: 'error'; message: string };

const slug = (s: string) => s.replace(/[^A-Za-z0-9._+-]+/g, '_');

export async function runSteps(o: {
  steps: CommandStep[];
  kind: 'step' | 'prepare';
  runDir: string;
  cwd: string;
  env: Record<string, string>;
  registry: Registry;
  state: RegistryState;
  session: number;
  timeoutMs: number;
  onProgress: (done: number, total: number) => void;
}): Promise<StepsEnd> {
  const doneSet = o.kind === 'prepare' ? o.state.prepared : o.state.steps;
  let done = o.steps.filter((s) => doneSet.has(s.key)).length;
  o.onProgress(done, o.steps.length);
  for (const s of o.steps) {
    if (doneSet.has(s.key)) continue;
    const dir = join(o.runDir, o.kind === 'prepare' ? 'prepare-logs' : 'steps', slug(s.key), `s${o.session}`);
    const f = await startChild({
      argv: s.argv,
      cwd: o.cwd,
      env: o.env,
      dir,
      timeoutMs: o.timeoutMs,
      pidDir: join(o.runDir, 'pids'),
    }).done;
    const c = classifyAttempt(f);
    const at = new Date().toISOString();
    if (c.class === 'cap') {
      o.registry.append({ t: 'cap_stop', at, resetAt: c.resetAt, message: c.reason });
      return { state: 'paused', reason: 'cap', resetAt: c.resetAt };
    }
    const exitCode = f.exitCode ?? -1;
    o.registry.append(
      o.kind === 'prepare'
        ? { t: 'prepare_complete', at, key: s.key, exitCode }
        : { t: 'step_complete', at, key: s.key, exitCode },
    );
    if (exitCode !== 0) {
      return {
        state: 'error',
        message: `${o.kind} ${s.key} exited ${exitCode} (${c.reason}); log: ${join(dir, 'output.txt')}`,
      };
    }
    doneSet.add(s.key);
    done++;
    o.onProgress(done, o.steps.length);
  }
  return { state: 'complete' };
}
