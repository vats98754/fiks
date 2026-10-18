#!/usr/bin/env node
// Mechanical claims check for README.md and DEMO.md (the claims-auditor agent does the rest):
// every [Cnn] exists in RESEARCH.md, and every line with a percentage or a decimal number
// carries a claim ID or a (bench) tag. Code blocks are skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const research = readFileSync(join(root, 'RESEARCH.md'), 'utf8');
const known = new Set([...research.matchAll(/\*\*(C\d+)\b/g)].map((m) => m[1]));
const problems = [];
for (const doc of ['README.md', 'DEMO.md']) {
  const file = join(root, doc);
  if (!existsSync(file)) {
    problems.push(`${doc}: missing`);
    continue;
  }
  let fenced = false;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim().startsWith('```')) fenced = !fenced;
      if (fenced) return;
      for (const m of line.matchAll(/\[(C\d+)(?:[,\s–-]+C?\d+)*\]/g)) {
        for (const id of m[0].match(/C?\d+/g).map((x) => (x.startsWith('C') ? x : `C${x}`))) {
          if (!known.has(id)) problems.push(`${doc}:${i + 1}: ${id} is not in RESEARCH.md`);
        }
      }
      const numeric = /(?<![\w.^#=/-])\d+(?:\.\d+)?\s?%|(?<![\w.^#=/-])\d+\.\d+(?![\w.])/.test(
        line.replace(/≥ \d+(\.\d+)*/g, ''),
      );
      if (numeric && !/\[C\d+/.test(line) && !/\(bench\)/.test(line)) {
        problems.push(`${doc}:${i + 1}: number without a claim ID or (bench): ${line.trim().slice(0, 100)}`);
      }
    });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('[check-claims] README.md and DEMO.md: every claim ID exists; every number is tagged');
