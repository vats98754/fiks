#!/usr/bin/env node
// Starts the vendor API: VENDOR_VERSION=v1|v2 [VENDOR_DRIFTS=D1,D3] [PORT=4010]
//   [--catalog original|extended-only|all] [--extended <file>] (or VENDOR_CATALOG, VENDOR_EXTENDED_CATALOG)
import { parseArgs } from 'node:util';
import { parseCatalogMode } from './catalog.ts';
import { createVendor } from './server.ts';

const { values } = parseArgs({
  options: { catalog: { type: 'string' }, extended: { type: 'string' } },
});
const raw = process.env.VENDOR_VERSION ?? 'v1';
if (raw !== 'v1' && raw !== 'v2') {
  console.error(`[vendor-api] VENDOR_VERSION must be v1 or v2, got ${JSON.stringify(raw)}`);
  process.exit(2);
}
const version = raw;
let catalog: ReturnType<typeof parseCatalogMode>;
try {
  catalog = parseCatalogMode(values.catalog ?? process.env.VENDOR_CATALOG);
} catch (e) {
  console.error(`[vendor-api] ${(e as Error).message}`);
  process.exit(2);
}
const vendor = createVendor({
  version,
  drifts: process.env.VENDOR_DRIFTS,
  catalog,
  extended: values.extended,
});
const url = await vendor.listen(Number(process.env.PORT ?? 4010));
const shown = catalog === 'original' ? '' : ` catalog=${catalog}`;
console.error(
  `[vendor-api] ${version} drifts=[${vendor.state.drifts.join(',')}]${shown} listening on ${url}`,
);
