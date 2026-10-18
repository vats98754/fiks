#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { callOnce } from './commands/call.ts';
import { recordFixtures } from './commands/record-fixtures.ts';
import { rerecord } from './commands/rerecord.ts';
import { runScenario, SCENARIOS } from './commands/scenario.ts';
import { vendorDiff } from './commands/vendor-diff.ts';

const USAGE = `usage: fiks <command> [options]

commands:
  vendor-diff [--json]                     compare vendor v1 and v2 (spec and behavior)
  record-fixtures --vendor v1 [--out dir]  record baseline fixtures into shop-mcp
  rerecord <recording.json>...             re-record calls through the current shop-mcp code
  scenario <id> [--transport stdio|http]   run a scripted scenario through fiks-proxy (ids: v1-all, D1..D5)
  call <tool> '<json args>' [--vendor v2] [--drifts D2] [--compare-direct]
                                           one call through fiks-proxy`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    vendor: { type: 'string', default: 'v1' },
    out: { type: 'string' },
    drifts: { type: 'string' },
    transport: { type: 'string', default: 'stdio' },
    'compare-direct': { type: 'boolean', default: false },
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
  case 'scenario': {
    const id = positionals[0] ?? '';
    if (!SCENARIOS[id]) {
      console.error(`unknown scenario ${JSON.stringify(id)}; known: ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(2);
    }
    const r = await runScenario(id, { transport: values.transport === 'http' ? 'http' : 'stdio' });
    print(r, () =>
      [
        `scenario ${r.scenario} (vendor ${r.vendor} drifts=[${r.drifts.join(',')}], ${r.transport})`,
        ...r.calls.map((c) => `  ${c.tool} ${JSON.stringify(c.args)}\n    ${c.text}`),
      ].join('\n'),
    );
    break;
  }
  case 'call': {
    const [tool, json] = positionals;
    if (!tool) {
      console.error(USAGE);
      process.exit(2);
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(json ?? '{}');
    } catch {
      console.error(`arguments must be a JSON object, got ${JSON.stringify(json)}`);
      process.exit(2);
    }
    const r = await callOnce({
      tool,
      args,
      vendor: values.vendor === 'v2' ? 'v2' : 'v1',
      drifts: values.drifts,
      transport: values.transport === 'http' ? 'http' : 'stdio',
      compareDirect: values['compare-direct'],
    });
    print(r, () => {
      const last = r.result.content?.at(-1) as { text?: string } | undefined;
      const lines = [last?.text ?? '(no receipt)'];
      if (r.upstreamIdentical !== undefined)
        lines.push(`upstream result identical to a direct call: ${r.upstreamIdentical}`);
      return lines.join('\n');
    });
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
