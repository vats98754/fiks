#!/usr/bin/env node
// Copies the bench evidence the dashboard shows into apps/dashboard/public/data. The dashboard
// renders only these files: no number is typed into its source.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'apps/dashboard/public/data');
mkdirSync(out, { recursive: true });
const files = [
  ['bench/results/summary.json', 'summary.json'],
  ['bench/results/loop/events.jsonl', 'events.jsonl'],
];
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.error(`[copy-data] missing ${from}; run \`pnpm fiks summarize\` first`);
    process.exit(1);
  }
  copyFileSync(src, join(out, to));
}
console.log(`[copy-data] ${files.length} files -> apps/dashboard/public/data`);
