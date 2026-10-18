import { readFileSync, writeFileSync } from 'node:fs';
import { buildProbeArgs, findContract, type Recording, SHOP_CONTRACTS } from '@fiks/contracts';
import { VERSION_DATES, type VendorVersion } from '@fiks/vendor-api';
import { startHarness } from '../harness.ts';

export function vendorVersionOf(rec: Recording): VendorVersion {
  if (rec.upstream?.version === 'v1' || rec.upstream?.version === 'v2') return rec.upstream.version;
  const hit = (Object.entries(VERSION_DATES) as [VendorVersion, string][]).find(
    ([, date]) => date === rec.vendorVersionHeader,
  );
  if (!hit) throw new Error(`${rec.id}: unknown vendorVersionHeader ${rec.vendorVersionHeader}`);
  return hit[0];
}

/**
 * Re-runs a recorded call through the current shop-mcp code against the same upstream
 * (version and active drifts, from `rec.upstream`), and writes `<file>.rerecorded.json`.
 */
export async function rerecord(file: string, opts: { shopDir?: string } = {}) {
  const rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
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
    const target = file.replace(/\.json$/, '.rerecorded.json');
    writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
    return { file: target, vendor };
  } finally {
    await h.close();
  }
}
