import { createHash } from 'node:crypto';
import type { InjectorRule, RerecordProfile, SuiteRun } from '@fiks/interfaces';
import { reproHooks } from '@fiks/repro';
import { repoRelative, rerecord } from './rerecord.ts';

export const STALE = /UNMATCHED_REQUEST: the current code makes upstream requests (\S+\.json) never recorded/;

/** Paths `rerecord()` accepts in its default (non-overlay) mode, relative to the repo. */
export const RERECORDABLE = /^test\/[\w./-]+\.json$/;

export interface Rerecorded {
  /** Repo-relative path of the `.rerecorded.json`. */
  file: string;
  /** sha256 of `bytes`. */
  sha256: string;
  /** The exact bytes fiks produced in memory. Callers write these; they never read them back. */
  bytes: string;
  /** The stale recording it replaces (as named in the failure message). */
  source: string;
}

export interface RerecordStaleOptions {
  maxPasses?: number;
  fromCommit?: string;
  /** Injector-aware profile and its rule (P7); default: each recording's own upstream. */
  profile?: RerecordProfile;
  rule?: InjectorRule;
  /** Domain whose suite finds the stale recordings (default: the profile's, else `shop`). */
  domain?: string;
  /**
   * Stale files `rerecord()` would refuse (outside `test/`) are reported here instead of
   * throwing. Without it they throw, as at ec241bc.
   */
  onUnsupported?: (file: string) => void;
  /** Runs the suite (default: the domain's suite over its scope). */
  runSuite?: (repoDir: string) => SuiteRun;
}

/** Files a suite run reports as stale (UNMATCHED_REQUEST), as named in the failure messages. */
export function staleFiles(run: SuiteRun): string[] {
  const out = new Set<string>();
  for (const f of run.failed) {
    const m = STALE.exec(f.message);
    if (m?.[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * After a fix, finds recordings the code no longer applies to (it now makes upstream requests
 * they never saw) and re-records each against the same upstream profile. fiks does this, never
 * the repair agent.
 */
export async function rerecordStale(repoDir: string, opts: RerecordStaleOptions = {}): Promise<Rerecorded[]> {
  const maxPasses = opts.maxPasses ?? 2;
  const domain = opts.profile?.domain ?? opts.domain ?? 'shop';
  const run =
    opts.runSuite ??
    ((dir: string) => {
      const { suite } = reproHooks(domain);
      return suite.run(dir, suite.scope);
    });
  const written: Rerecorded[] = [];
  const unsupported = new Set<string>();
  for (let pass = 0; pass < maxPasses; pass++) {
    const stale = staleFiles(run(repoDir)).filter((f) => !unsupported.has(f));
    if (stale.length === 0) break;
    let progressed = false;
    for (const file of stale) {
      if (opts.onUnsupported) {
        let rel: string | undefined;
        try {
          rel = repoRelative(repoDir, file);
        } catch {}
        if (!rel || !RERECORDABLE.test(rel) || rel.endsWith('.rerecorded.json') || rel.includes('..')) {
          unsupported.add(file);
          opts.onUnsupported(file);
          continue;
        }
      }
      const { rel, bytes } = await rerecord(file, {
        shopDir: repoDir,
        fromCommit: opts.fromCommit,
        profile: opts.profile,
        rule: opts.rule,
        domain,
      });
      progressed = true;
      written.push({
        file: rel,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes,
        source: file,
      });
    }
    if (!progressed) break;
  }
  return written;
}
