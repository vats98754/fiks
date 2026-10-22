// Legacy adapter for `fiks vendor-diff` (ec241bc flags and output).
import { vendorDiff } from '../commands/vendor-diff.ts';
import { type LegacyCommand, parse, printer, usageLines } from './common.ts';

export const name = 'vendor-diff';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  const print = printer(values);
  const r = await vendorDiff(values.domain ?? 'shop');
  print(r, () =>
    [
      `openapi.json identical: ${r.openapiIdentical}`,
      ...r.behaviorDiffs.map(
        (d) => `${d.drift} ${d.title}: ${d.probe}: v1=${JSON.stringify(d.v1)} v2=${JSON.stringify(d.v2)}`,
      ),
    ].join('\n'),
  );
}

export default { name, help, run } satisfies LegacyCommand;
