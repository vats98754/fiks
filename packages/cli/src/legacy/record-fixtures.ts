// Legacy adapter for `fiks record-fixtures` (ec241bc flags and output; plus --domain).
import { recordFixtures } from '../commands/record-fixtures.ts';
import { type LegacyCommand, parse, printer, usageLines } from './common.ts';

export const name = 'record-fixtures';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  const print = printer(values);
  const domain = values.domain ?? 'shop';
  const r = await recordFixtures({
    vendor: domain === 'shop' ? (values.vendor === 'v2' ? 'v2' : 'v1') : values.vendor,
    drifts: values.drifts,
    out: values.out,
    ...(domain === 'shop' ? {} : { domain }),
  });
  print(r, () => `wrote ${r.written.length} fixtures to ${r.out}`);
}

export default { name, help, run } satisfies LegacyCommand;
