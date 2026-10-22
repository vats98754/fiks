import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProbeArgs,
  type ContractFile,
  findContract,
  type Recording,
  SHOP_CONTRACTS,
} from '@fiks/contracts';
import { FIXTURE_CALLS } from '@fiks/vendor-api';
import { harnessDomain, startHarness } from '../harness.ts';
import { repoDir } from '../paths.ts';

/** The contracts of `domain` (shop: SHOP_CONTRACTS; others: their Domain's contractsPath). */
export function contractsOf(domain = 'shop'): ContractFile {
  const d = harnessDomain(domain);
  if (!d || d.id === 'shop') return SHOP_CONTRACTS;
  return JSON.parse(readFileSync(d.contractsPath, 'utf8')) as ContractFile;
}

export { FIXTURE_CALLS };

export async function recordFixtures(opts: {
  vendor: string;
  drifts?: string;
  out?: string;
  shopDir?: string;
  domain?: string;
}) {
  const domain = opts.domain ?? 'shop';
  const d = harnessDomain(domain);
  const calls = d ? d.fixtureCalls : FIXTURE_CALLS;
  const contracts = contractsOf(domain);
  const versionHeader = d?.versionHeader ?? 'vendor-api-version';
  const out = opts.out ?? join(opts.shopDir ?? repoDir(domain), 'test/fixtures', opts.vendor);
  mkdirSync(out, { recursive: true });
  const clock = new Date();
  const h = await startHarness({
    vendor: opts.vendor,
    drifts: opts.drifts,
    clock,
    shopDir: opts.shopDir,
    domain,
  });
  const written: string[] = [];
  try {
    for (const c of calls) {
      const capturedAt = clock.toISOString();
      const { result, http } = await h.call(c.tool, c.args);
      const rec: Recording = {
        id: `${opts.vendor}-${c.slug}`,
        capturedAt,
        tool: c.tool,
        args: c.args,
        result,
        http,
        vendorVersionHeader: http[0]?.response.headers[versionHeader],
        upstream: { version: opts.vendor, drifts: h.vendorDrifts, clock: clock.toISOString() },
      };
      const post = findContract(contracts, c.tool)?.postconditions?.[0];
      if (post && result.structuredContent && !result.isError) {
        const args = buildProbeArgs(post, result.structuredContent);
        const probe = await h.call(post.probeTool, args);
        rec.probe = { tool: post.probeTool, args, result: probe.result, http: probe.http };
      }
      const file = join(out, `${c.slug}.json`);
      writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
      written.push(file);
    }
  } finally {
    await h.close();
  }
  return { out, written };
}
