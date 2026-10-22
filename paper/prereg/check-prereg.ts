// PREREG.md checker.
//
//   pnpm tsx paper/prereg/check-prereg.ts [--final] [--plan <file>] [--prereg <file>]
//   pnpm tsx paper/prereg/check-prereg.ts --selftest
//
// Every block (heading, table row, code block, list item, paragraph) of PLAN.md sections 3, 4,
// 5.5, 5.7, 8.2, 9 and 13 must appear verbatim in PREREG.md (whitespace runs collapsed; nothing
// else normalised). The named rule classes (H endpoints, tests, margins and rationale, direction
// guards, readings, n rules, the N_E rule, IV, the REPRO-AGENT F check, the H2 as-it-behaves and
// re-record rules, re-record parity, request-changing class, E4/E7, cut order, exclusions, infra)
// are located by anchor and reported per class. Part I must register the constants PLAN leaves to
// PREREG and state what PLAN requires it to state. --final (the F5 tag) also rejects open
// <<FILL@...>> slots. Exit 0 = PASS, 1 = FAIL, 2 = usage error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPrereg } from './lib/prereg-check.ts';

const USAGE = 'usage: check-prereg.ts [--final] [--plan <file>] [--prereg <file>] | --selftest';

/** Mutations of the real PREREG.md that must each make the check fail. */
function selftest(plan: string, prereg: string): number {
  const base = checkPrereg(plan, prereg);
  const mutate = (from: string, to: string) => {
    if (!prereg.includes(from)) throw new Error(`selftest: "${from}" not in PREREG.md`);
    return prereg.replace(from, to);
  };
  const cases: { name: string; text: string; final?: boolean; expect: string }[] = [
    {
      name: 'H3b margin changed (0.10 -> 0.15)',
      text: mutate('d_i = p_FIKS,i − p_L1,i; margin δ = 0.10.', 'd_i = p_FIKS,i − p_L1,i; margin δ = 0.15.'),
      expect: 'margin and margin rationale / H3b',
    },
    {
      name: 'H3a direction guard dropped',
      text: mutate('H3a counts as rejected only if mean d_i > 0', 'H3a counts as rejected if'),
      expect: 'direction guard / H3a',
    },
    {
      name: 'a reading row reworded',
      text: mutate('| H4 not rejected | Not established', '| H4 not rejected | Not shown'),
      expect: 'reading / H4-not-rejected',
    },
    {
      name: 'cut-order step 6 removed',
      text: prereg.replace(/^\| 6 \| R7 to 6 payloads.*\n/m, ''),
      expect: 'cut-order step / 6',
    },
    {
      name: 'exclusion 5 removed',
      text: mutate('5. Persistent-infra cells (pairwise).', ''),
      expect: 'exclusion rule / 5',
    },
    {
      name: 'inline-recording rule removed',
      text: mutate('A recording inlined in a test file cannot be re-recorded.', ''),
      expect: 'H2 re-record rule / inline',
    },
    {
      name: 'sign-flip seed unregistered',
      text: mutate('seed.signflip.H2 = ', 'seed.signflip.H2x = '),
      expect: 'seed.signflip.H2 is not registered',
    },
    {
      name: 'PLAN-fixed constant changed',
      text: mutate('signflip.flips = 200000', 'signflip.flips = 100000'),
      expect: 'PLAN fixes 200000',
    },
    { name: '--final with open FILL slots', text: prereg, final: true, expect: 'slots are still open' },
  ];
  let bad = base.errors.length === 0 ? 0 : 1;
  console.log(`${bad === 0 ? 'ok  ' : 'BAD '} unmodified PREREG.md passes (${base.errors.length} errors)`);
  for (const c of cases) {
    const r = checkPrereg(plan, c.text, { final: c.final });
    const ok = r.errors.some((e) => e.includes(c.expect));
    if (!ok) bad++;
    console.log(
      `${ok ? 'ok  ' : 'BAD '} fails: ${c.name}${ok ? '' : ` (errors: ${r.errors.slice(0, 3).join(' | ')})`}`,
    );
  }
  console.log(bad === 0 ? `selftest PASS (${cases.length + 1} cases)` : `selftest FAIL (${bad})`);
  return bad === 0 ? 0 : 1;
}

function main(argv: string[]): number {
  const here = fileURLToPath(new URL('.', import.meta.url));
  let planPath = resolve(here, '../PLAN.md');
  let preregPath = resolve(here, 'PREREG.md');
  let final = false;
  let self = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--final') final = true;
    else if (a === '--selftest') self = true;
    else if (a === '--plan' && argv[i + 1] !== undefined) planPath = resolve(argv[++i] as string);
    else if (a === '--prereg' && argv[i + 1] !== undefined) preregPath = resolve(argv[++i] as string);
    else {
      console.error(USAGE);
      return 2;
    }
  }
  const plan = readFileSync(planPath, 'utf8');
  const prereg = readFileSync(preregPath, 'utf8');
  if (self) return selftest(plan, prereg);
  const r = checkPrereg(plan, prereg, { final });
  const sections = Object.entries(r.blocksBySection)
    .map(([s, n]) => `§${s}: ${n}`)
    .join(', ');
  console.log(`PLAN blocks checked verbatim: ${r.blocksChecked} (${sections})`);
  for (const [cat, ids] of Object.entries(r.categories)) {
    console.log(
      `  ${ids.length > 0 ? 'ok  ' : 'FAIL'} ${cat.padEnd(34)} ${ids.length} rules: ${ids.join(', ')}`,
    );
  }
  console.log(`registered constants: ${Object.keys(r.constants).length}; open FILL slots: ${r.fills}`);
  for (const e of r.errors) console.log(`FAIL ${e}`);
  console.log(
    r.errors.length === 0
      ? `check-prereg PASS${final ? ' (--final)' : ''}`
      : `check-prereg FAIL (${r.errors.length} errors)`,
  );
  return r.errors.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
