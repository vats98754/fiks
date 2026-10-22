// The append-only run registry (<runDir>/registry.jsonl). One writer (the coordinator). A block
// enters the registry only as ONE line when it is complete (all its arms, with every attempt row),
// so a kill at any moment leaves either the whole block or nothing: incomplete blocks are never in
// the registry, are discarded (artifacts quarantined) and re-run whole, and every run key appears
// at most once. Each line is written with a single write(2) on an O_APPEND descriptor plus fsync;
// a line torn by `kill -9` is skipped on load and a newline is appended before the next write.

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';

export type AttemptClass = 'done' | 'infra' | 'cap';

/** One arm attempt of a completed block. Status only: no correctness, verdict or CI field. */
export interface AttemptRow {
  runKey: string;
  arm: string;
  model: string;
  /** Position of this arm in the block's seeded order. */
  order: number;
  /** Tries used (1 + infra re-queues, <= 3). */
  tries: number;
  exitCode: number | null;
  class: AttemptClass;
  /** sha256 over the attempt's result files (attempt.json/result.json), null if none. */
  resultSha: string | null;
  /** Relative to the run dir. */
  dir: string;
  wallMs: number;
}

export type RegistryEvent =
  | { t: 'run_start'; at: string; pid: number; argv: string[]; workers: number; fiksCommit: string }
  | { t: 'prepare_complete'; at: string; key: string; exitCode: number }
  | { t: 'step_complete'; at: string; key: string; exitCode: number }
  | { t: 'block_complete'; at: string; block: string; worker: number; rows: AttemptRow[] }
  | { t: 'block_dropped'; at: string; block: string; reason: string; arm: string; tries: number }
  | { t: 'block_discarded'; at: string; block: string; reason: string; quarantine: string | null }
  | { t: 'cap_stop'; at: string; resetAt: string | null; message: string }
  | { t: 'pause'; at: string; reason: string }
  | { t: 'checkpoint'; at: string; blocksDone: number; blocksTotal: number }
  | { t: 'run_end'; at: string; state: 'complete' | 'paused' | 'failed' };

export interface RegistryState {
  events: RegistryEvent[];
  /** Lines that did not parse (a torn last line after kill -9). */
  skipped: number;
  completeBlocks: Map<string, Extract<RegistryEvent, { t: 'block_complete' }>>;
  droppedBlocks: Map<string, Extract<RegistryEvent, { t: 'block_dropped' }>>;
  prepared: Set<string>;
  steps: Set<string>;
}

export function loadRegistry(file: string): RegistryState {
  const st: RegistryState = {
    events: [],
    skipped: 0,
    completeBlocks: new Map(),
    droppedBlocks: new Map(),
    prepared: new Set(),
    steps: new Set(),
  };
  if (!existsSync(file)) return st;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let e: RegistryEvent;
    try {
      e = JSON.parse(line) as RegistryEvent;
    } catch {
      st.skipped++;
      continue;
    }
    if (!e || typeof e !== 'object' || typeof (e as { t?: unknown }).t !== 'string') {
      st.skipped++;
      continue;
    }
    st.events.push(e);
    if (e.t === 'block_complete' && !st.completeBlocks.has(e.block)) st.completeBlocks.set(e.block, e);
    if (e.t === 'block_dropped' && !st.droppedBlocks.has(e.block)) st.droppedBlocks.set(e.block, e);
    if (e.t === 'prepare_complete' && e.exitCode === 0) st.prepared.add(e.key);
    if (e.t === 'step_complete' && e.exitCode === 0) st.steps.add(e.key);
  }
  return st;
}

export class Registry {
  private fd: number;
  constructor(readonly file: string) {
    const torn =
      existsSync(file) && !readFileSync(file, 'utf8').endsWith('\n') && readFileSync(file).length > 0;
    this.fd = openSync(file, 'a');
    if (torn) this.raw('\n');
  }

  private raw(s: string): void {
    writeSync(this.fd, s);
    fsyncSync(this.fd);
  }

  append(e: RegistryEvent): void {
    this.raw(`${JSON.stringify(e)}\n`);
  }

  close(): void {
    closeSync(this.fd);
  }
}

/** Every attempt row of every completed block, in registry order. */
export function outcomeRows(st: RegistryState): AttemptRow[] {
  return [...st.completeBlocks.values()].flatMap((b) => b.rows);
}
