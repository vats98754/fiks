import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Recording, Violation } from '@fiks/contracts';
import type { RerecordProfile } from '@fiks/interfaces';
import type { CallRecord } from '@fiks/proxy';

/** A captured silent failure: the exact call, its upstream HTTP, and what it violated. */
export interface Trace extends Recording {
  runId: string;
  contractId: string;
  violated: Violation[];
  server: { name: string; transport: 'stdio' | 'http'; gitSha?: string };
  /**
   * Injector-aware upstream profile (P7): domain, base vendor version, injector rule id and hash.
   * Absent on traces captured from the versioned vendor alone (D1-D5); `upstream` then says it all.
   */
  profile?: RerecordProfile;
}

export function traceId(rec: CallRecord): string {
  const h = createHash('sha256')
    .update(JSON.stringify([rec.tool, rec.args, rec.at]))
    .digest('hex')
    .slice(0, 10);
  return `tr_${h}`;
}

export function traceFromCall(
  rec: CallRecord,
  meta: {
    runId: string;
    upstream: Trace['upstream'];
    server: Trace['server'];
    target?: string[];
    profile?: RerecordProfile;
  },
): Trace {
  return {
    id: traceId(rec),
    capturedAt: rec.at,
    runId: meta.runId,
    contractId: rec.receipt.contractId ?? '',
    tool: rec.tool,
    args: rec.args,
    result: rec.result,
    http: rec.http,
    ...(rec.probe ? { probe: rec.probe } : {}),
    vendorVersionHeader: rec.http[0]?.response.headers['vendor-api-version'],
    upstream: meta.upstream,
    violated: rec.receipt.violations,
    ...(meta.target ? { target: meta.target } : {}),
    server: meta.server,
    ...(meta.profile ? { profile: meta.profile } : {}),
  };
}

export function saveTrace(dir: string, trace: Trace): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${trace.id}.json`);
  writeFileSync(file, `${JSON.stringify(trace, null, 2)}\n`);
  return file;
}

export function loadTrace(file: string): Trace {
  return JSON.parse(readFileSync(file, 'utf8')) as Trace;
}

export function listTraces(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}
