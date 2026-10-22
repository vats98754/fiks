// Legacy adapter for `fiks rerecord` (ec241bc flags and output; plus --domain).
import { resolve } from 'node:path';
import { rerecord } from '../commands/rerecord.ts';
import { type LegacyCommand, parse, printer, usageLines } from './common.ts';

export const name = 'rerecord';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values, positionals } = parse(argv);
  if (values.help) return void console.log(help());
  const print = printer(values);
  const done: Awaited<ReturnType<typeof rerecord>>[] = [];
  const opts = values.domain && values.domain !== 'shop' ? { domain: values.domain } : {};
  for (const f of positionals) done.push(await rerecord(resolve(f), opts));
  print(done, () => done.map((d) => `wrote ${d.file} (vendor ${d.vendor})`).join('\n'));
}

export default { name, help, run } satisfies LegacyCommand;
