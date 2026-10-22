// Legacy adapter for `fiks scenario` (ec241bc flags and output; plus --domain).
import { runScenario, scenariosOf } from '../commands/scenario.ts';
import { type LegacyCommand, parse, printer, usageLines } from './common.ts';

export const name = 'scenario';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values, positionals } = parse(argv);
  if (values.help) return void console.log(help());
  const print = printer(values);
  const domain = values.domain ?? 'shop';
  const scenarios = scenariosOf(domain);
  const id = positionals[0] ?? '';
  if (!scenarios[id]) {
    console.error(`unknown scenario ${JSON.stringify(id)}; known: ${Object.keys(scenarios).join(', ')}`);
    process.exit(2);
  }
  const r = await runScenario(id, {
    transport: values.transport === 'http' ? 'http' : 'stdio',
    shopRef: values['shop-ref'],
    ...(domain === 'shop' ? {} : { domain }),
  });
  print(r, () =>
    [
      `scenario ${r.scenario} (vendor ${r.vendor} drifts=[${r.drifts.join(',')}], ${r.transport})`,
      ...r.calls.map((c) => `  ${c.tool} ${JSON.stringify(c.args)}\n    ${c.text}`),
    ].join('\n'),
  );
}

export default { name, help, run } satisfies LegacyCommand;
