// Legacy adapter for `fiks demo` (ec241bc flags and output).
import { demo } from '../commands/demo.ts';
import { type LegacyCommand, parse, printer, shopOnly, usageLines } from './common.ts';

export const name = 'demo';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  const r = await demo({
    drifts: (values.drifts ?? 'D1,D2,D3').split(','),
    base: values.base === 'fresh' ? 'fresh' : 'main',
    untilFGate: values['until-f-gate'],
  });
  print(r, () =>
    [
      `base branch: ${r.base}`,
      ...r.results.map((x) => `${x.scenario}: ${x.status} ${x.pr ?? ''} (${x.reason})`),
      r.missing ? `missing: ${r.missing}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const want = r.credential && !values['until-f-gate'] ? 'pr_opened' : 'ready';
  if (r.missing || r.results.some((x) => x.status !== want)) process.exitCode = 1;
}

export default { name, help, run } satisfies LegacyCommand;
