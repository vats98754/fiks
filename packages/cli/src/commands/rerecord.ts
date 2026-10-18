import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { buildProbeArgs, findContract, type Recording, SHOP_CONTRACTS } from '@fiks/contracts';
import { formatInMemory } from '@fiks/repro';
import { VERSION_DATES, type VendorVersion } from '@fiks/vendor-api';
import { startHarness } from '../harness.ts';
import { shopDir as defaultShopDir } from '../paths.ts';

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

/**
 * Re-runs a recorded call through the current shop-mcp code against the same upstream
 * (version, active drifts and frozen clock, from the recording) and writes
 * `<name>.rerecorded.json` next to it. With `fromCommit`, the input is the committed blob of a
 * tracked `test/**.json` file, never the worktree copy, and fiks checks that the result is the
 * same call against the same upstream before returning the bytes it now owns.
 */
export async function rerecord(file: string, opts: { shopDir?: string; fromCommit?: string } = {}) {
  const repo = opts.shopDir ?? defaultShopDir();
  const rel = repoRelative(repo, file);
  if (!/^test\/[\w./-]+\.json$/.test(rel) || rel.endsWith('.rerecorded.json') || rel.includes('..')) {
    throw new Error(`rerecord: refusing ${rel}`);
  }
  const rec = JSON.parse(
    opts.fromCommit
      ? execFileSync('git', ['show', `${opts.fromCommit}:${rel}`], { cwd: repo, encoding: 'utf8' })
      : readFileSync(join(repo, rel), 'utf8'),
  ) as Recording;
  const vendor = vendorVersionOf(rec);
  const drifts = rec.upstream?.drifts?.join(',');
  const clock = new Date(rec.upstream?.clock ?? rec.capturedAt);
  const h = await startHarness({ vendor, drifts, clock, shopDir: opts.shopDir });
  try {
    const capturedAt = rec.capturedAt;
    const { result, http } = await h.call(rec.tool, rec.args);
    const out: Recording = {
      id: `${rec.id}.rerecorded`,
      capturedAt,
      tool: rec.tool,
      args: rec.args,
      result,
      http,
      vendorVersionHeader: http[0]?.response.headers['vendor-api-version'],
      upstream: { version: vendor, drifts: h.vendor.state.drifts, clock: clock.toISOString() },
      violated: rec.violated,
      target: rec.target,
    };
    const post = findContract(SHOP_CONTRACTS, rec.tool)?.postconditions?.[0];
    if (post && result.structuredContent && !result.isError) {
      const args = buildProbeArgs(post, result.structuredContent);
      const probe = await h.call(post.probeTool, args);
      out.probe = { tool: post.probeTool, args, result: probe.result, http: probe.http };
    }
    if (!sameCallAndUpstream(out, rec)) {
      throw new Error(`rerecord: ${rel} re-recorded against a different call or upstream`);
    }
    const targetRel = rel.replace(/\.json$/, '.rerecorded.json');
    // The final bytes are built in this process and returned; callers own them, not the disk.
    const bytes = formatInMemory(basename(targetRel), `${JSON.stringify(out, null, 2)}\n`);
    writeFileSync(join(repo, targetRel), bytes);
    return { file: join(repo, targetRel), rel: targetRel, vendor, bytes };
  } finally {
    await h.close();
  }
}
