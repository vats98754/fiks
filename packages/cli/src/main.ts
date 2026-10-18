#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { recordFixtures } from './commands/record-fixtures.ts';
import { rerecord } from './commands/rerecord.ts';
import { vendorDiff } from './commands/vendor-diff.ts';

const USAGE = `usage: fiks <command> [options]

commands:
  vendor-diff [--json]                     compare vendor v1 and v2 (spec and behavior)
  record-fixtures --vendor v1 [--out dir]  record baseline fixtures into shop-mcp
  rerecord <recording.json>...             re-record calls through the current shop-mcp code`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    vendor: { type: 'string', default: 'v1' },
    out: { type: 'string' },
    drifts: { type: 'string' },
  },
});

function print(data: unknown, human: () => string) {
  console.log(values.json ? JSON.stringify(data, null, 2) : human());
}

switch (command) {
  case 'vendor-diff': {
    const r = await vendorDiff();
    print(r, () =>
      [
        `openapi.json identical: ${r.openapiIdentical}`,
        ...r.behaviorDiffs.map(
          (d) => `${d.drift} ${d.title}: ${d.probe}: v1=${JSON.stringify(d.v1)} v2=${JSON.stringify(d.v2)}`,
        ),
      ].join('\n'),
    );
    break;
  }
  case 'record-fixtures': {
    const r = await recordFixtures({
      vendor: values.vendor === 'v2' ? 'v2' : 'v1',
      drifts: values.drifts,
      out: values.out,
    });
    print(r, () => `wrote ${r.written.length} fixtures to ${r.out}`);
    break;
  }
  case 'rerecord': {
    const done: Awaited<ReturnType<typeof rerecord>>[] = [];
    for (const f of positionals) done.push(await rerecord(f));
    print(done, () => done.map((d) => `wrote ${d.file} (vendor ${d.vendor})`).join('\n'));
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
