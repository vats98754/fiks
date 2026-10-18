import { createHash } from 'node:crypto';
import { runSuite } from '@fiks/repro';
import { rerecord } from './rerecord.ts';

const STALE = /UNMATCHED_REQUEST: the current code makes upstream requests (\S+\.json) never recorded/;

export interface Rerecorded {
  /** Repo-relative path of the `.rerecorded.json`. */
  file: string;
  /** sha256 of `bytes`. */
  sha256: string;
  /** The exact bytes fiks produced in memory. Callers write these; they never read them back. */
  bytes: string;
}

/**
 * After a fix, finds recordings the code no longer applies to (it now makes upstream requests
 * they never saw) and re-records each against the same upstream profile. fiks does this, never
 * the repair agent.
 */
export async function rerecordStale(
  repoDir: string,
  opts: { maxPasses?: number; fromCommit?: string } = {},
): Promise<Rerecorded[]> {
  const maxPasses = opts.maxPasses ?? 2;
  const written: Rerecorded[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const stale = new Set<string>();
    for (const f of runSuite(repoDir).failed) {
      const m = STALE.exec(f.message);
      if (m?.[1]) stale.add(m[1]);
    }
    if (stale.size === 0) break;
    for (const file of stale) {
      const { rel, bytes } = await rerecord(file, { shopDir: repoDir, fromCommit: opts.fromCommit });
      written.push({ file: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes });
    }
  }
  return written;
}
