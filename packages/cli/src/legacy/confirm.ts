// Legacy adapter for `fiks confirm` (ec241bc flags and output).
import { confirm } from '../commands/confirm.ts';
import { type LegacyCommand, parse, printer, shopOnly, usageLines } from './common.ts';

export const name = 'confirm';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  const r = await confirm();
  print(r, () =>
    r.length
      ? r
          .map(
            (c) =>
              `${c.scenario ?? c.traceId}: ${c.confirmed ? 'CONFIRMED' : c.merged ? 'NOT CONFIRMED' : 'not merged'} (${c.reason}) ${c.pr}`,
          )
          .join('\n')
      : 'no fiks PRs found in .fiks/repairs',
  );
}

export default { name, help, run } satisfies LegacyCommand;
