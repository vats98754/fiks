import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_RECEIPT_FIELD, RECEIPT_META_KEY, type Receipt } from '@fiks/proxy';
import type { VendorVersion } from '@fiks/vendor-api';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { startHarness } from '../harness.ts';

/** The proxied result with fiks's additions removed: _meta receipt, trailing text block, receipt field. */
export function stripReceipt(r: CallToolResult, field = DEFAULT_RECEIPT_FIELD): CallToolResult {
  const { _meta, ...rest } = r;
  const meta = { ...(_meta ?? {}) };
  delete meta[RECEIPT_META_KEY];
  const out: CallToolResult = { ...rest, content: (r.content ?? []).slice(0, -1) };
  if (r.structuredContent) {
    const { [field]: _receipt, ...upstream } = r.structuredContent;
    out.structuredContent = upstream;
  }
  if (Object.keys(meta).length) out._meta = meta;
  return out;
}

export async function callOnce(opts: {
  tool: string;
  args: Record<string, unknown>;
  vendor: VendorVersion;
  drifts?: string;
  transport?: 'stdio' | 'http';
  compareDirect?: boolean;
}) {
  const h = await startHarness({
    vendor: opts.vendor,
    drifts: opts.drifts,
    via: 'proxy',
    transport: opts.transport,
  });
  let result: CallToolResult;
  try {
    result = (await h.call(opts.tool, opts.args)).result;
  } finally {
    await h.close();
  }
  const receipt = result._meta?.[RECEIPT_META_KEY] as Receipt | undefined;
  let upstreamIdentical: boolean | undefined;
  let direct: CallToolResult | undefined;
  if (opts.compareDirect) {
    const d = await startHarness({ vendor: opts.vendor, drifts: opts.drifts, transport: opts.transport });
    try {
      direct = (await d.call(opts.tool, opts.args)).result;
    } finally {
      await d.close();
    }
    upstreamIdentical = isDeepStrictEqual(stripReceipt(result), direct);
  }
  return { tool: opts.tool, args: opts.args, result, receipt, upstreamIdentical, direct };
}
