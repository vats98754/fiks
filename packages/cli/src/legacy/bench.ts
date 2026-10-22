// Legacy adapter for `fiks bench` (ec241bc flags and output). BENCHX's default export in
// commands/bench.ts replaces it once it exists (P18).
import { bench } from '../commands/bench.ts';
import { type LegacyCommand, parse, printer, shopOnly, USAGE, usageLines } from './common.ts';

export const name = 'bench';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  const phase = values.phase as 'A' | 'B' | 'C';
  if (values['shop-ref'] !== undefined && values['shop-ref'] !== 'pr-heads') {
    console.error(`--shop-ref only accepts pr-heads (phase C), got ${JSON.stringify(values['shop-ref'])}`);
    process.exit(2);
  }
  if (!['A', 'B', 'C'].includes(phase)) {
    console.error(USAGE);
    process.exit(2);
  }
  const r = await bench({
    phase,
    k: Number(values.k),
    tasks: values.tasks?.split(','),
    model: values.model,
    shopRef: values['shop-ref'] === 'pr-heads' ? 'pr-heads' : undefined,
    out: values.out,
    direct: values.direct,
    noReceiptField: values['no-receipt-field'],
    onTrial: (t) => {
      if (!values.json) console.error(`${t.phase} ${t.taskId} #${t.trial}: ${t.outcome} (${t.reason})`);
    },
  });
  print(
    r,
    () => `${r.runId}: ${r.trials.filter((t) => t.pass).length}/${r.trials.length} passed -> ${r.out}`,
  );
}

export default { name, help, run } satisfies LegacyCommand;
