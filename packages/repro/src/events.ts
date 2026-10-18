import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type LoopEventType =
  | 'violation'
  | 'trace_saved'
  | 'repro_generated'
  | 'gate_F'
  | 'repair_started'
  | 'rerecorded'
  | 'gate_local'
  | 'branch_pushed'
  | 'gate_ci'
  | 'pr_opened'
  | 'pr_merged'
  | 'confirmed';

export interface LoopEvent {
  ts: string;
  runId: string;
  type: LoopEventType;
  traceId?: string;
  propertyId?: string;
  ok?: boolean;
  data?: Record<string, unknown>;
}

/** Appends one event to a JSONL log. Every number shown anywhere is derived from these logs. */
export function appendEvent(path: string, e: Omit<LoopEvent, 'ts'> & { ts?: string }): LoopEvent {
  const ev: LoopEvent = { ts: e.ts ?? new Date().toISOString(), ...e } as LoopEvent;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(ev)}\n`);
  return ev;
}

export function readEvents(path: string): LoopEvent[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LoopEvent);
  } catch {
    return [];
  }
}
