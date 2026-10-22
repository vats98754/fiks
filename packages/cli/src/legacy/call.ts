// Legacy adapter for `fiks call` (ec241bc flags and output).
import { callOnce } from '../commands/call.ts';
import { type LegacyCommand, parse, printer, shopOnly, USAGE, usageLines } from './common.ts';

export const name = 'call';
export const help = () => usageLines(name);

export async function run(argv: string[]) {
  const { values, positionals } = parse(argv);
  if (values.help) return void console.log(help());
  shopOnly(name, values);
  const print = printer(values);
  const [tool, json] = positionals;
  if (!tool) {
    console.error(USAGE);
    process.exit(2);
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(json ?? '{}');
  } catch {
    console.error(`arguments must be a JSON object, got ${JSON.stringify(json)}`);
    process.exit(2);
  }
  const r = await callOnce({
    tool,
    args,
    vendor: values.vendor === 'v2' ? 'v2' : 'v1',
    drifts: values.drifts,
    transport: values.transport === 'http' ? 'http' : 'stdio',
    compareDirect: values['compare-direct'],
    shopRef: values['shop-ref'],
  });
  print(r, () => {
    const last = r.result.content?.at(-1) as { text?: string } | undefined;
    const lines = [last?.text ?? '(no receipt)'];
    if (r.upstreamIdentical !== undefined)
      lines.push(`upstream result identical to a direct call: ${r.upstreamIdentical}`);
    return lines.join('\n');
  });
}

export default { name, help, run } satisfies LegacyCommand;
