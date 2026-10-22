// Prints (or, with --write, records) the sha256 of every judge prompt file in prompts/HASHES.json.
// A test fails when a prompt changes without its recorded hash (PLAN 6.1: prompt iterations logged).
import { writeFileSync } from 'node:fs';
import { promptHashes, variantPromptHash } from '../src/judge.ts';

const doc = {
  files: promptHashes(),
  variants: { 'B-JUDGE': variantPromptHash('B-JUDGE'), 'B-JUDGE+U': variantPromptHash('B-JUDGE+U') },
};
const text = `${JSON.stringify(doc, null, 2)}\n`;
if (process.argv.includes('--write')) writeFileSync(new URL('../prompts/HASHES.json', import.meta.url), text);
process.stdout.write(text);
