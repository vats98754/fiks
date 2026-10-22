// Classifies one finished arm subprocess as a model outcome ('done'), an infra error (re-queued
// <= 2 times, PLAN 9.3) or a usage-cap stop. Reads only status fields (exit code, status/stop
// strings, the error text), never a correctness or CI field.
//
// Contract with the arm commands (ORCH `fiks repair --arm`, ARMS `fiks arm`):
//  - exit 75 (EX_TEMPFAIL) = infra error; exit 76 = usage cap;
//  - or a result.json `status` / attempt.json `stop` starting with 'infra_error' or 'cap';
//  - or an error text that LLMR's classifier calls a cap (cap) or a retryable failure (infra) when
//    the command exits with neither 0 nor 1 and wrote no result;
//  - a signal, a spawn failure or the runner's hard timeout = infra (harness crash / no output).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { classifyLlmFailure, RETRYABLE } from '@fiks/llm';
import type { AttemptClass } from './registry.ts';

export const EXIT_INFRA = 75;
export const EXIT_CAP = 76;

const RESULT_FILES = new Set(['result.json', 'attempt.json']);

/** Result files under `dir` (recursive), sorted by relative path. */
export function resultFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (RESULT_FILES.has(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function resultSha(dir: string): string | null {
  const files = resultFiles(dir);
  if (files.length === 0) return null;
  const h = createHash('sha256');
  for (const f of files) {
    h.update(relative(dir, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

function statusStrings(dir: string): string[] {
  const out: string[] = [];
  for (const f of resultFiles(dir)) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as {
        status?: unknown;
        stop?: unknown;
        outcome?: unknown;
      };
      for (const v of [j.status, j.stop]) if (typeof v === 'string') out.push(v);
    } catch {
      // A torn result file is not a status.
    }
  }
  return out;
}

export interface Finished {
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  timedOut: boolean;
  /** Last few KB of stdout + stderr. */
  tail: string;
  /** The attempt's FIKS_DIR. */
  fiksDir: string;
}

export interface Classified {
  class: AttemptClass;
  reason: string;
  resetAt: string | null;
}

export function classifyAttempt(f: Finished): Classified {
  if (f.spawnError) return { class: 'infra', reason: `spawn failed: ${f.spawnError}`, resetAt: null };
  if (f.timedOut) return { class: 'infra', reason: 'runner hard timeout', resetAt: null };
  if (f.exitCode === EXIT_CAP) {
    const c = classifyLlmFailure(f.tail);
    return {
      class: 'cap',
      reason: 'exit 76 (usage cap)',
      resetAt: c.kind === 'cap' ? (c.resetAt ?? null) : null,
    };
  }
  if (f.exitCode === EXIT_INFRA) return { class: 'infra', reason: 'exit 75 (infra error)', resetAt: null };
  const statuses = statusStrings(f.fiksDir);
  if (statuses.some((s) => /^cap\b/.test(s))) {
    const c = classifyLlmFailure(f.tail);
    return {
      class: 'cap',
      reason: 'result status: cap',
      resetAt: c.kind === 'cap' ? (c.resetAt ?? null) : null,
    };
  }
  if (statuses.some((s) => s.startsWith('infra_error')))
    return { class: 'infra', reason: 'result status: infra_error', resetAt: null };
  if (f.signal) return { class: 'infra', reason: `killed by ${f.signal}`, resetAt: null };
  if (f.exitCode === 0 || f.exitCode === 1)
    return { class: 'done', reason: `exit ${f.exitCode}`, resetAt: null };
  // Any other exit with a recorded result is the arm's own outcome; without one it is a crash.
  if (statuses.length > 0)
    return { class: 'done', reason: `exit ${f.exitCode} with a result`, resetAt: null };
  const c = classifyLlmFailure(f.tail);
  if (c.kind === 'cap')
    return { class: 'cap', reason: `cap: ${c.message.slice(0, 200)}`, resetAt: c.resetAt ?? null };
  if (RETRYABLE.has(c.kind))
    return { class: 'infra', reason: `${c.kind}: ${c.message.slice(0, 200)}`, resetAt: null };
  return { class: 'infra', reason: `exit ${f.exitCode} with no result (harness crash)`, resetAt: null };
}
