#!/usr/bin/env node
// Starts the vendor API: VENDOR_VERSION=v1|v2 [VENDOR_DRIFTS=D1,D3] [PORT=4010]
import { createVendor } from './server.ts';

const raw = process.env.VENDOR_VERSION ?? 'v1';
if (raw !== 'v1' && raw !== 'v2') {
  console.error(`[vendor-api] VENDOR_VERSION must be v1 or v2, got ${JSON.stringify(raw)}`);
  process.exit(2);
}
const version = raw;
const vendor = createVendor({ version, drifts: process.env.VENDOR_DRIFTS });
const url = await vendor.listen(Number(process.env.PORT ?? 4010));
console.error(`[vendor-api] ${version} drifts=[${vendor.state.drifts.join(',')}] listening on ${url}`);
