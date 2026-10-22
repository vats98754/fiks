// Legacy adapter for `fiks summarize` (ec241bc flags and output). BENCHX's default export in
// commands/summarize.ts replaces it once it exists (P18).
import { summarize } from '../commands/summarize.ts';
import { type LegacyCommand, parse, printer, shopOnly, usageLines } from './common.ts';

export const name = 'summarize';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  const r = summarize({ check: values.check });
  print(values.check ? { ok: r.ok, diff: r.diff } : r.summary, () =>
    values.check ? (r.ok ? 'summary.json matches the logs' : (r.diff ?? 'mismatch')) : `wrote ${r.file}`,
  );
  if (!r.ok) process.exitCode = 1;
}

export default { name, help, run } satisfies LegacyCommand;
