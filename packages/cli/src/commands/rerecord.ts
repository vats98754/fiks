import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { buildProbeArgs, findContract, type Recording } from '@fiks/contracts';
import type { InjectorRule, RerecordProfile } from '@fiks/interfaces';
import { formatInMemory } from '@fiks/repro';
import { VERSION_DATES, type VendorVersion } from '@fiks/vendor-api';
import { harnessDomain, startHarness } from '../harness.ts';
import { repoDir as defaultRepoDir } from '../paths.ts';
import { contractsOf } from './record-fixtures.ts';

export function vendorVersionOf(rec: Recording): VendorVersion {
  if (rec.upstream?.version === 'v1' || rec.upstream?.version === 'v2') return rec.upstream.version;
  const hit = (Object.entries(VERSION_DATES) as [VendorVersion, string][]).find(
    ([, date]) => date === rec.vendorVersionHeader,
  );
  if (!hit) throw new Error(`${rec.id}: unknown vendorVersionHeader ${rec.vendorVersionHeader}`);
  return hit[0];
}

/**
 * The repo-relative path of `file` inside `repo`, computed as a string: an agent-controlled
 * path is never resolved through the filesystem (a planted symlink would redirect it). Only
 * `repo` itself is resolved, for the macOS /var -> /private/var case.
 */
export function repoRelative(repo: string, file: string): string {
  for (const root of [repo, realpathSync(repo)]) {
    const prefix = `${root.replace(/\/$/, '')}/`;
    if (file.startsWith(prefix)) return file.slice(prefix.length);
  }
  if (!isAbsolute(file)) return file;
  throw new Error(`rerecord: ${file} is not inside ${repo}`);
}

/** Same call, same upstream: what a re-recording must share with the recording it replaces. */
export function sameCallAndUpstream(a: Recording, b: Recording): boolean {
  const key = (r: Recording) =>
    JSON.stringify([
      r.tool,
      r.args,
      r.upstream?.version,
      [...(r.upstream?.drifts ?? [])].sort(),
      r.upstream?.clock,
      r.vendorVersionHeader,
    ]);
  return key(a) === key(b);
}

/** A recording that carries its injector-aware profile (traces captured through an injector). */
type ProfiledRecording = Recording & { profile?: RerecordProfile };

const sameProfile = (a: RerecordProfile, b: RerecordProfile) =>
  a.domain === b.domain && a.base === b.base && a.ruleId === b.ruleId && a.ruleHash === b.ruleHash;

export interface RerecordOptions {
  /** Checkout of the tool repo (default: the domain's repo). */
  shopDir?: string;
  /** Read the committed blob of the file at this commit instead of the worktree copy. */
  fromCommit?: string;
  /**
   * Injector-aware profile (P7): with a rule id, the vendor runs at `profile.base` with the rule
   * in front of it (the `rule` object must match id and hash); without one, the recording's own
   * upstream (version, drifts, clock) decides, as at ec241bc.
   */
  profile?: RerecordProfile;
  rule?: InjectorRule;
  /** Domain (default: the profile's, else `shop`). */
  domain?: string;
  /**
   * Overlay mode (P23): any repo-relative `.json` path is accepted (e.g. `.alerts/<id>.json`),
   * the output keeps the original id, and nothing is written: the caller owns the bytes.
   */
  overlay?: boolean;
  /** Recording bytes to use instead of reading the file (overlay originals saved by the caller). */
  source?: string;
}

/**
 * Re-runs a recorded call through the current tool code against the same upstream (version,
 * active drifts and frozen clock, from the recording; plus the profile's injector rule) and
 * writes `<name>.rerecorded.json` next to it. With `fromCommit`, the input is the committed blob
 * of a tracked `test/**.json` file, never the worktree copy, and fiks checks that the result is
 * the same call against the same upstream before returning the bytes it now owns. Every call
 * starts a fresh upstream chain (vendor, injector, tap).
 */
export async function rerecord(file: string, opts: RerecordOptions = {}) {
  const domain = opts.profile?.domain ?? opts.domain ?? 'shop';
  const d = harnessDomain(domain);
  const repo = opts.shopDir ?? defaultRepoDir(domain);
  const rel = repoRelative(repo, file);
  const allowed = opts.overlay
    ? /^[\w.][\w./-]*\.json$/.test(rel) && !rel.split('/').includes('..') && !rel.startsWith('.git/')
    : /^test\/[\w./-]+\.json$/.test(rel) && !rel.endsWith('.rerecorded.json') && !rel.includes('..');
  if (!allowed) throw new Error(`rerecord: refusing ${rel}`);
  const rec = JSON.parse(
    opts.source ??
      (opts.fromCommit
        ? execFileSync('git', ['show', `${opts.fromCommit}:${rel}`], { cwd: repo, encoding: 'utf8' })
        : readFileSync(join(repo, rel), 'utf8')),
  ) as ProfiledRecording;

  // The profile decides the upstream chain; a recording that names its own profile must agree.
  const profile = opts.profile ?? rec.profile;
  if (opts.profile && rec.profile && !sameProfile(opts.profile, rec.profile)) {
    throw new Error(
      `rerecord: ${rel} was captured under a different profile (${JSON.stringify(rec.profile)})`,
    );
  }
  let rule: InjectorRule | undefined;
  if (profile?.ruleId) {
    rule = opts.rule;
    if (!rule || rule.id !== profile.ruleId || rule.hash !== profile.ruleHash) {
      throw new Error(
        `rerecord: profile rule ${profile.ruleId} (hash ${profile.ruleHash}) needs the matching injector rule`,
      );
    }
  }
  const vendor =
    rule && profile ? profile.base : d && d.id !== 'shop' ? rec.upstream?.version : vendorVersionOf(rec);
  if (!vendor) throw new Error(`${rec.id}: the recording names no vendor version`);
  const drifts = rule ? undefined : rec.upstream?.drifts?.join(',');
  const clock = new Date(rec.upstream?.clock ?? rec.capturedAt);
  const h = await startHarness({ vendor, drifts, clock, shopDir: opts.shopDir, domain, injector: rule });
  try {
    const capturedAt = rec.capturedAt;
    const versionHeader = d?.versionHeader ?? 'vendor-api-version';
    const { result, http } = await h.call(rec.tool, rec.args);
    const out: ProfiledRecording = {
      id: opts.overlay ? rec.id : `${rec.id}.rerecorded`,
      capturedAt,
      tool: rec.tool,
      args: rec.args,
      result,
      http,
      vendorVersionHeader: http[0]?.response.headers[versionHeader],
      upstream: { version: vendor, drifts: h.vendorDrifts, clock: clock.toISOString() },
      violated: rec.violated,
      target: rec.target,
      ...(rec.profile ? { profile: rec.profile } : {}),
    };
    const post = findContract(contractsOf(domain), rec.tool)?.postconditions?.[0];
    if (post && result.structuredContent && !result.isError) {
      const args = buildProbeArgs(post, result.structuredContent);
      const probe = await h.call(post.probeTool, args);
      out.probe = { tool: post.probeTool, args, result: probe.result, http: probe.http };
    }
    if (!sameCallAndUpstream(out, rec)) {
      throw new Error(`rerecord: ${rel} re-recorded against a different call or upstream`);
    }
    const targetRel = opts.overlay ? rel : rel.replace(/\.json$/, '.rerecorded.json');
    // The final bytes are built in this process and returned; callers own them, not the disk.
    const bytes = formatInMemory(basename(targetRel), `${JSON.stringify(out, null, 2)}\n`);
    if (!opts.overlay) writeFileSync(join(repo, targetRel), bytes);
    return { file: join(repo, targetRel), rel: targetRel, vendor, bytes };
  } finally {
    await h.close();
  }
}
