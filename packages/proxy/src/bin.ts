#!/usr/bin/env node
// fiks-proxy: an MCP proxy that checks every tool result against an outcome contract.
//
//   fiks-proxy --contracts shop-mcp.contracts.json [--tap VENDOR_BASE_URL] [--listen http:3334]
//              [--events .fiks/events.jsonl] -- <upstream command> [args...]
//   fiks-proxy --contracts c.json --upstream-url http://127.0.0.1:3333/mcp [--listen http:3334]
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import type { ContractFile } from '@fiks/contracts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { listenHttp } from './http.ts';
import { startProxy, type UpstreamConfig } from './proxy.ts';

const dash = process.argv.indexOf('--');
const own = dash === -1 ? process.argv.slice(2) : process.argv.slice(2, dash);
const upstreamCmd = dash === -1 ? [] : process.argv.slice(dash + 1);
const { values } = parseArgs({
  args: own,
  options: {
    contracts: { type: 'string' },
    tap: { type: 'string' },
    listen: { type: 'string', default: 'stdio' },
    'upstream-url': { type: 'string' },
    events: { type: 'string' },
    'receipt-field': { type: 'string' },
  },
});

if (!values.contracts || (!values['upstream-url'] && upstreamCmd.length === 0)) {
  console.error(
    'usage: fiks-proxy --contracts <file> [--tap ENV_VAR] [--listen stdio|http:PORT] [--events file] (-- <cmd> [args...] | --upstream-url URL)',
  );
  process.exit(2);
}

const listen = values.listen;
const port = listen === 'stdio' ? 0 : Number(listen.replace(/^http:/, ''));
if (listen !== 'stdio' && !(Number.isInteger(port) && port >= 0 && port < 65536)) {
  console.error(`--listen must be "stdio" or "http:<port>", got ${JSON.stringify(listen)}`);
  process.exit(2);
}
if (values.tap && values['upstream-url']) {
  console.error(
    `[fiks-proxy] warning: --tap ${values.tap} needs a stdio upstream that fiks starts; with --upstream-url the upstream HTTP is not observed, so upstream checks are skipped (receipt _meta: upstreamObserved=false).`,
  );
}

const contracts = JSON.parse(readFileSync(values.contracts, 'utf8')) as ContractFile;
const upstream: UpstreamConfig = values['upstream-url']
  ? { transport: 'http', url: values['upstream-url'] }
  : { transport: 'stdio', command: upstreamCmd[0] as string, args: upstreamCmd.slice(1) };
const events = values.events;
if (events) mkdirSync(dirname(events), { recursive: true });

const proxy = await startProxy({
  upstream,
  contracts,
  tapEnvVar: values['upstream-url'] ? undefined : values.tap,
  receiptField: values['receipt-field'] === 'none' ? null : values['receipt-field'],
  onCall: (rec) => {
    if (events) appendFileSync(events, `${JSON.stringify({ type: 'call', ...rec })}\n`);
    return undefined;
  },
});

const shutdown = async () => {
  await proxy.close().catch(() => undefined);
  process.exit(0);
};
// If the upstream server dies, every later call would fail: exit so the agent restarts us.
proxy.upstream.onclose = shutdown;
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (listen === 'stdio') {
  const transport = new StdioServerTransport();
  // When the agent closes stdin, stop the upstream child too.
  process.stdin.on('end', shutdown);
  const server = await proxy.connect(transport);
  server.onclose = shutdown;
} else {
  const h = await listenHttp(proxy, port);
  console.error(`[fiks-proxy] Streamable HTTP on ${h.url}`);
}
