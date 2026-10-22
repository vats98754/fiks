// One worker = one OS process (forked by the coordinator) with its own FIKS_DIR. It plays the arms
// of one block at a time, in the block's seeded order, each arm as a subprocess with a per-try
// FIKS_DIR. Infra errors are re-queued <= 2 times (PLAN 9.3); a persistent one drops the cell for
// all arms. A cap stops the block at once. It reports status only (class, tries, exit code).

import { join } from 'node:path';
import { type RunningChild, startChild } from './child.ts';
import { classifyAttempt, resultSha } from './classify.ts';
import type { AttemptRow } from './registry.ts';
import type { Block } from './schedule.ts';

export interface BlockJobMsg {
  type: 'block';
  block: Block;
  runDir: string;
  cwd: string;
  env: Record<string, string>;
  session: number;
  timeoutMs: number;
  maxRequeues: number;
}

export type WorkerMsg =
  | { type: 'progress'; block: string; runKey: string; try: number; class: AttemptRow['class'] }
  | {
      type: 'block_result';
      block: string;
      status: 'complete' | 'dropped' | 'cap' | 'aborted' | 'error';
      rows: AttemptRow[];
      error?: string;
      dropped?: { arm: string; tries: number; reason: string };
      cap?: { resetAt: string | null; message: string };
    };

let current: RunningChild | null = null;
let aborted = false;

function send(m: WorkerMsg): void {
  process.send?.(m);
}

async function runBlock(m: BlockJobMsg): Promise<WorkerMsg> {
  const rows: AttemptRow[] = [];
  for (const [order, job] of m.block.jobs.entries()) {
    const started = Date.now();
    for (let attemptTry = 1; ; attemptTry++) {
      if (aborted) return { type: 'block_result', block: m.block.id, status: 'aborted', rows };
      const dir = join(m.runDir, job.dir, `s${m.session}-try${attemptTry}`);
      current = startChild({
        argv: job.argv,
        cwd: m.cwd,
        env: m.env,
        dir,
        timeoutMs: m.timeoutMs,
        pidDir: join(m.runDir, 'pids'),
      });
      const f = await current.done;
      current = null;
      if (aborted) return { type: 'block_result', block: m.block.id, status: 'aborted', rows };
      const c = classifyAttempt(f);
      send({ type: 'progress', block: m.block.id, runKey: job.runKey, try: attemptTry, class: c.class });
      if (c.class === 'cap') {
        return {
          type: 'block_result',
          block: m.block.id,
          status: 'cap',
          rows,
          cap: { resetAt: c.resetAt, message: c.reason },
        };
      }
      if (c.class === 'infra') {
        if (attemptTry <= m.maxRequeues) continue;
        return {
          type: 'block_result',
          block: m.block.id,
          status: 'dropped',
          rows,
          dropped: { arm: job.arm, tries: attemptTry, reason: c.reason },
        };
      }
      rows.push({
        runKey: job.runKey,
        arm: job.arm,
        model: job.model,
        order,
        tries: attemptTry,
        exitCode: f.exitCode,
        class: 'done',
        resultSha: resultSha(f.fiksDir),
        dir: join(job.dir, `s${m.session}-try${attemptTry}`),
        wallMs: Date.now() - started,
      });
      break;
    }
  }
  return { type: 'block_result', block: m.block.id, status: 'complete', rows };
}

process.on('message', (raw) => {
  const m = raw as BlockJobMsg | { type: 'abort' } | { type: 'exit' };
  if (m.type === 'abort') {
    aborted = true;
    current?.kill();
    return;
  }
  if (m.type === 'exit') {
    current?.kill();
    process.disconnect?.();
    return;
  }
  if (m.type === 'block') {
    aborted = false;
    runBlock(m).then(send, (e: unknown) =>
      send({
        type: 'block_result',
        block: m.block.id,
        status: 'error',
        rows: [],
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
});

// The coordinator is gone (killed or crashed): stop this worker's subprocess tree and exit.
process.on('disconnect', () => {
  current?.kill();
  process.exit(0);
});
