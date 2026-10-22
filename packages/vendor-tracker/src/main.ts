#!/usr/bin/env node
// Starts the tracker vendor: [--catalog original|extended-only|all] [--port 4020]
// Env: TRACKER_CATALOG, TRACKER_EXTENDED_CATALOG (extended entities JSON), PORT,
// TRACKER_CLOCK (ISO instant: a frozen clock for every timestamp the API writes).
import { parseArgs } from 'node:util';
import { parseCatalogMode } from './catalog.ts';
import { createVendor } from './server.ts';

const { values } = parseArgs({
  options: { catalog: { type: 'string' }, port: { type: 'string' } },
  strict: true,
});
let catalog: ReturnType<typeof parseCatalogMode>;
try {
  catalog = parseCatalogMode(values.catalog ?? process.env.TRACKER_CATALOG);
} catch (e) {
  console.error(`[vendor-tracker] ${(e as Error).message}`);
  process.exit(2);
}
const clock = process.env.TRACKER_CLOCK;
if (clock !== undefined && Number.isNaN(Date.parse(clock))) {
  console.error(`[vendor-tracker] TRACKER_CLOCK is not an ISO instant: ${JSON.stringify(clock)}`);
  process.exit(2);
}
const vendor = createVendor({ catalog, now: clock ? () => new Date(clock) : undefined });
const url = await vendor.listen(Number(values.port ?? process.env.PORT ?? 4020));
console.error(
  `[vendor-tracker] v1 catalog=${catalog} issues=${vendor.state.issues.length} listening on ${url}`,
);
