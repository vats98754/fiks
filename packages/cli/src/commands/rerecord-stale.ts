import { runSuite } from '@fiks/repro';
import { rerecord } from './rerecord.ts';

const STALE = /UNMATCHED_REQUEST: the current code makes upstream requests (\S+\.json) never recorded/;

/**
 * After a fix, finds recordings the code no longer applies to (it now makes upstream requests
 * they never saw) and re-records each against the same upstream profile. fiks does this, never
 * the repair agent. Returns the `.rerecorded.json` files written.
 */
export async function rerecordStale(repoDir: string, maxPasses = 2): Promise<string[]> {
  const written: string[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const stale = new Set<string>();
    for (const f of runSuite(repoDir).failed) {
      const m = STALE.exec(f.message);
      if (m?.[1]) stale.add(m[1]);
    }
    if (stale.size === 0) break;
    for (const file of stale) written.push((await rerecord(file, { shopDir: repoDir })).file);
  }
  return written;
}
