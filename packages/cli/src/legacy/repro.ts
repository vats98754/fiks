// Legacy adapter for `fiks repro` (ec241bc flags and output; plus --trace, --domain, --fetch,
// --run-key: P13, P17).
import { repro } from '../commands/repro.ts';
import { type LegacyCommand, parse, printer, USAGE, usageLines } from './common.ts';

export const name = 'repro';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values } = parse(argv);
  if (values.help) return void console.log(help());
  const print = printer(values);
  if (!values.scenario && !values.trace) {
    console.error(USAGE);
    process.exit(2);
  }
  const r = await repro({
    scenario: values.scenario,
    trace: values.trace,
    ref: values.target,
    runs: Number(values.runs),
    keep: values.keep,
    ...(values.domain && values.domain !== 'shop' ? { domain: values.domain } : {}),
    ...(values.fetch ? { fetch: true } : {}),
    ...(values['run-key'] ? { runKey: values['run-key'] } : {}),
  });
  print(r, () =>
    [
      `trace ${r.trace.id}: ${r.trace.tool} ${JSON.stringify(r.trace.args)} violated ${r.trace.violated.join(', ')}`,
      `repro test ${r.spec.testPath} (target ${r.spec.propertyIds.join(', ')})`,
      `F gate on ${values.target}: ${r.gateF.ok ? 'PASS' : 'FAIL'}: ${r.gateF.reason}`,
      ...r.gateF.evidence.failed.map((f) => `  failing: ${f.test}\n    ${f.message.split('\n')[0]}`),
    ].join('\n'),
  );
  if (!r.gateF.ok) process.exitCode = 1;
}

export default { name, help, run } satisfies LegacyCommand;
