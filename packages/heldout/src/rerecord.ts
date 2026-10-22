// Calls CORE's `fiks rerecord-head` (P23) for the grader and accept(): always inside the grading
// container, through SBX execFiks with --require-sandbox (the CLI exits 2 outside the container),
// with the drift's profile (P7: domain, base vendor version, injector rule id, rule hash) and the
// rule as mounted at RULE_DIR. Without a command the overlay stays in place for the checks that
// follow; `restoreOverlay` puts the originals back (a restore re-records nothing).
import type { RerecordCheck, RerecordLog, RerecordProfile } from '@fiks/interfaces';
import { fiksIn, type GradingSandbox, readIn, run, SCRATCH, WORKDIR } from './sandbox.ts';

export interface RerecordCall {
  profile: RerecordProfile;
  /** Container path of the rule JSON (RULE_DIR/rule.json). */
  rulePath: string;
  /** The commit stale recordings are read from (the drift's base). */
  fromCommit: string;
  check: RerecordCheck;
  /** Repo-relative recordings to overlay (beyond what the suite reads). */
  recordings: readonly string[];
}

export interface RerecordOutcome {
  exit: number;
  log: RerecordLog | null;
  /** Restore manifest (container path) when the overlay is in place. */
  manifest?: string;
  /** No file of the log failed and the CLI exited 0. */
  ok: boolean;
  stderr: string;
}

export const RERECORD_LOG = `${SCRATCH}/rerecord.jsonl`;
const MANIFEST = `${SCRATCH}/overlay/manifest.json`;

/** The argv given to execFiks (exported for the spy tests). */
export function rerecordArgv(c: RerecordCall): string[] {
  return [
    'rerecord-head',
    '--worktree',
    WORKDIR,
    '--profile',
    JSON.stringify(c.profile),
    '--rule',
    c.rulePath,
    '--from',
    c.fromCommit,
    '--log',
    RERECORD_LOG,
    '--check',
    c.check,
    ...(c.recordings.length ? ['--recordings', [...c.recordings].sort().join(',')] : []),
    '--manifest',
    MANIFEST,
    '--json',
    '--require-sandbox',
  ];
}

export async function rerecordIn(sb: GradingSandbox, c: RerecordCall): Promise<RerecordOutcome> {
  await run(sb, 'mkdir', ['-p', `${SCRATCH}/overlay`]);
  const r = await fiksIn(sb, rerecordArgv(c), { timeoutMs: 15 * 60_000 });
  let log: RerecordLog | null = null;
  let manifest: string | undefined;
  const last = r.stdout
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'));
  if (last) {
    try {
      const j = JSON.parse(last) as { log?: RerecordLog; manifest?: string };
      log = j.log ?? null;
      manifest = j.manifest;
    } catch {
      // fall back to the log file
    }
  }
  if (!log) {
    const text = await readIn(sb, RERECORD_LOG);
    const line = text?.trim().split('\n').at(-1);
    if (line) log = JSON.parse(line) as RerecordLog;
  }
  const failed = log?.files.some((f) => f.outcome === 'failed') ?? true;
  return {
    exit: r.code,
    log,
    ...(manifest ? { manifest } : {}),
    ok: r.code === 0 && !failed,
    stderr: r.stderr,
  };
}

export async function restoreOverlay(sb: GradingSandbox, manifest: string | undefined): Promise<void> {
  if (!manifest) return;
  await fiksIn(sb, ['rerecord-head', '--restore', manifest, '--require-sandbox']);
}
