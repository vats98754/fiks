// Captures the tool definitions (tools/list) that a shop-mcp ref publishes, through the pinned MCP
// SDK client over stdio, so B-SCHEMA and B-AJV validate against what an MCP client really receives.
//
// usage: pnpm tsx packages/baselines/scripts/capture-tooldefs.ts \
//          [--shop-dir .work/shop-mcp] [--ref seed-v1] [--out packages/baselines/fixtures/shop-tools.seed-v1.json]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const { values } = parseArgs({
  options: {
    'shop-dir': { type: 'string', default: join(root, '.work/shop-mcp') },
    ref: { type: 'string', default: 'seed-v1' },
    out: { type: 'string' },
  },
});
const shopDir = resolve(values['shop-dir'] as string);
const ref = values.ref as string;
const out = resolve(values.out ?? join(root, `packages/baselines/fixtures/shop-tools.${ref}.json`));

const commit = execFileSync('git', ['-C', shopDir, 'rev-parse', `${ref}^{commit}`], {
  encoding: 'utf8',
}).trim();
const work = mkdtempSync(join(tmpdir(), 'fiks-tooldefs-'));
try {
  execFileSync('sh', ['-c', `git -C "${shopDir}" archive "${commit}" | tar -x -C "${work}"`]);
  symlinkSync(join(shopDir, 'node_modules'), join(work, 'node_modules'));
  const transport = new StdioClientTransport({
    command: join(shopDir, 'node_modules/.bin/tsx'),
    args: [join(work, 'src/main.ts')],
    cwd: work,
    // tools/list needs no vendor; the URL is never contacted.
    env: { PATH: process.env.PATH ?? '', VENDOR_URL: 'http://127.0.0.1:9' },
  });
  const client = new Client({ name: 'fiks-capture-tooldefs', version: '0.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  const doc = { source: { repo: 'vats98754/shop-mcp', ref, commit }, tools };
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${tools.length} tool definitions from ${ref} (${commit.slice(0, 7)}) to ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
