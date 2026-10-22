// The frozen trace as ARMS reads it: the product trace format (packages/repro Trace), loaded as
// bytes so every copy (.alerts/<id>.json) is byte-identical to the frozen file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Recording, Violation } from '@fiks/contracts';
import type { RerecordProfile } from '@fiks/interfaces';

export interface FrozenTraceFile extends Recording {
  runId?: string;
  contractId?: string;
  violated?: Violation[];
  target?: string[];
  profile?: RerecordProfile;
}

export interface LoadedTrace {
  path: string;
  bytes: Buffer;
  sha256: string;
  trace: FrozenTraceFile;
}

export const sha256 = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');

export function loadFrozenTrace(path: string): LoadedTrace {
  const bytes = readFileSync(path);
  const trace = JSON.parse(bytes.toString('utf8')) as FrozenTraceFile;
  if (typeof trace?.id !== 'string' || typeof trace.tool !== 'string' || !Array.isArray(trace.http)) {
    throw new Error(`${path} is not a fiks trace (needs id, tool and http)`);
  }
  if (!/^[\w.-]+$/.test(trace.id))
    throw new Error(`${path}: trace id ${JSON.stringify(trace.id)} is not a file name`);
  return { path, bytes, sha256: sha256(bytes), trace };
}

/**
 * The trace's domain: its injector-aware profile when it has one (P7), else the prefix of its
 * contract id (`tracker.list_comments` -> `tracker`), else `shop` (traces captured before P8).
 */
export function traceDomain(t: FrozenTraceFile): string {
  if (t.profile?.domain) return t.profile.domain;
  const prefix = t.contractId?.split('.')[0];
  return prefix && /^[a-z0-9][a-z0-9-]*$/.test(prefix) ? prefix : 'shop';
}

/** The properties a fix must repair: `target`, else every violated property (product rule). */
export function traceTarget(t: FrozenTraceFile): string[] {
  return t.target ?? (t.violated ?? []).map((v) => v.propertyId);
}

/**
 * The drift's re-record profile (P7, P23): the trace's own, else (traces captured from the
 * versioned vendor alone, e.g. D1-D5) its upstream version with no injector rule; re-recording
 * then follows the recording's own upstream (version, drifts, clock).
 */
export function traceProfile(t: FrozenTraceFile, domain = traceDomain(t)): RerecordProfile {
  if (t.profile) return { ...t.profile };
  const base = t.upstream?.version;
  if (!base) throw new Error(`trace ${t.id} names neither a profile nor an upstream version`);
  return { domain, base, ruleId: null, ruleHash: null };
}
