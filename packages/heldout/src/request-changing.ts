// requestChanging(drift) (PLAN 3.0, round 5): true iff CORE `rerecord-head` on ref A, over the
// drift's frozen trace and enumeration, re-records at least one exchange. Mechanical, from ref A
// only (never from arm outputs), computed at F10 and written to the pool manifest; it selects the
// s3 sensitivity row (3.2) and the per-class report (3.3, 3.4). It runs in the grading container
// like every re-record.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { RerecordLog } from '@fiks/interfaces';
import { prepareHead, removeTree, writeInto } from './head.ts';
import { type LoadedPackage, profileOf } from './pkg.ts';
import { rerecordIn, restoreOverlay } from './rerecord.ts';
import { ruleMount, type SandboxFactory } from './sandbox.ts';

export interface RequestChangingResult {
  drift: string;
  requestChanging: boolean;
  /** Overlaid files whose re-recording made requests the recording never held. */
  rerecorded: string[];
  log: RerecordLog | null;
}

export async function requestChanging(
  p: LoadedPackage,
  env: {
    repoDir: string;
    sandbox: SandboxFactory;
    /** The frozen trace (placed at .alerts/<id>.json). */
    trace: { id: string; bytes: string };
    /** The drift's enumeration recordings (host paths). */
    enumeration: readonly string[];
  },
): Promise<RequestChangingResult> {
  const head = prepareHead(env.repoDir, p.pkg.base, readFileSync(p.refA, 'utf8'));
  if (!head.applied) throw new Error(`${p.pkg.id}: ref A does not apply: ${head.error}`);
  const files = [
    { path: `.alerts/${env.trace.id}.json`, bytes: env.trace.bytes },
    ...env.enumeration.map((f) => ({ path: `.fiks-enum/${basename(f)}`, bytes: readFileSync(f, 'utf8') })),
  ];
  writeInto(head.dir, files);
  const rule = ruleMount(p.rule);
  const sb = await env.sandbox(head.dir, [rule.mount]);
  try {
    const rr = await rerecordIn(sb, {
      profile: profileOf(p),
      rulePath: rule.rulePath,
      fromCommit: head.baseCommit,
      check: 'accept',
      recordings: files.map((f) => f.path),
    });
    await restoreOverlay(sb, rr.manifest);
    const named = new Set(files.map((f) => f.path));
    const rerecorded = (rr.log?.files ?? [])
      .filter((f) => f.mode === 'overlay' && named.has(f.path) && f.outcome === 'rerecorded')
      .map((f) => f.path)
      .sort();
    if (!rr.log)
      throw new Error(`${p.pkg.id}: rerecord-head wrote no log (exit ${rr.exit}): ${rr.stderr.slice(-500)}`);
    return { drift: p.pkg.id, requestChanging: rerecorded.length > 0, rerecorded, log: rr.log };
  } finally {
    await sb.cleanup();
    head.remove();
    removeTree(rule.mount.source);
  }
}
