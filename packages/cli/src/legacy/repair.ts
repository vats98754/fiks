// Legacy adapter for `fiks repair` (ec241bc flags and output). ORCH's default export in
// commands/repair.ts replaces it once it exists (P18).
import { repair } from '../commands/repair.ts';
import { type LegacyCommand, parse, printer, shopOnly, USAGE, usageLines } from './common.ts';

export const name = 'repair';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  if (!values.scenario && !values.trace) {
    console.error(USAGE);
    process.exit(2);
  }
  const r = await repair({
    scenario: values.scenario,
    traceFile: values.trace,
    base: values.base,
    noPr: values['no-pr'],
    model: values.model,
  });
  print(r, () =>
    [
      `${r.status}: ${r.reason}`,
      `trace ${r.traceId} -> branch ${r.branch} (${r.attempts} attempt(s), runner ${r.runner ?? '-'}, ${r.turns} turns)`,
      ...r.gates.map((g) => `  ${g.ok ? 'PASS' : 'FAIL'} ${g.gate}: ${g.reason}`),
      r.pr ? `PR: ${r.pr.url}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (r.status !== 'pr_opened' && r.status !== 'ready') process.exitCode = 1;
}

export default { name, help, run } satisfies LegacyCommand;
