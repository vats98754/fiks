// `fiks split` (stream BLIND; PLAN 5.1, F7): the seeded dev/test split of the kept blind drifts,
// stratified by domain x stratum x ideation family (20% dev + D1-D5; the rest is test).
//
//   pnpm fiks split --seed <s> [--in <kept.json>] [--out <split.json>]
//
// --in defaults to <blind repo>/kept.json (written by A1), --out to <blind repo>/split.json. Prints
// the split file's sha256; the same input and seed always give the same bytes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FIKS_ROOT, makeSplit, type SplitItem, sha256, splitText } from '@fiks/authoring';
import type { CliCommandModule } from '@fiks/interfaces';

const USAGE = 'usage: fiks split --seed <s> [--in kept.json] [--out split.json] [--blind-repo dir]';

const command: CliCommandModule = {
  name: 'split',
  describe: 'seeded, stratified dev/test split of the kept blind drifts',
  async run(argv) {
    let v: { seed?: string; in?: string; out?: string; 'blind-repo'?: string };
    try {
      v = parseArgs({
        args: argv,
        options: {
          seed: { type: 'string' },
          in: { type: 'string' },
          out: { type: 'string' },
          'blind-repo': { type: 'string' },
        },
      }).values;
    } catch (e) {
      console.error(`${(e as Error).message}\n${USAGE}`);
      return 2;
    }
    if (!v.seed) {
      console.error(USAGE);
      return 2;
    }
    const repo = resolve(v['blind-repo'] ?? join(FIKS_ROOT, '.work', 'driftbench-blind'));
    const input = resolve(v.in ?? join(repo, 'kept.json'));
    const out = resolve(v.out ?? join(repo, 'split.json'));
    let items: SplitItem[];
    try {
      items = JSON.parse(readFileSync(input, 'utf8')) as SplitItem[];
      if (!Array.isArray(items))
        throw new Error('expected an array of {id, domain, stratum, ideationFamily}');
    } catch (e) {
      console.error(`split: ${input}: ${(e as Error).message}`);
      return 1;
    }
    let text: string;
    try {
      text = splitText(makeSplit(items, v.seed));
    } catch (e) {
      console.error(`split: ${(e as Error).message}`);
      return 1;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    const s = JSON.parse(text) as { dev: string[]; test: string[] };
    console.log(`split: ${s.dev.length} dev + D1-D5, ${s.test.length} test -> ${out}`);
    console.log(`sha256 ${sha256(text)}`);
    return 0;
  },
};

export default command;
