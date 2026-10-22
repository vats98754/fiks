// Shared by the legacy command adapters (P18): the ec241bc USAGE text and flag table, so each
// adapter accepts exactly the flags and prints exactly the output `main.ts` did at ec241bc.
import { parseArgs } from 'node:util';

/** Byte-identical to the USAGE string of `git show ec241bc:packages/cli/src/main.ts`. */
export const USAGE = `usage: fiks <command> [options]

commands:
  vendor-diff [--json]                     compare vendor v1 and v2 (spec and behavior)
  record-fixtures --vendor v1 [--out dir]  record baseline fixtures into shop-mcp
  rerecord <recording.json>...             re-record calls through the current shop-mcp code
  scenario <id> [--transport stdio|http]   run a scripted scenario through fiks-proxy (ids: v1-all, D1..D5)
  call <tool> '<json args>' [--vendor v2] [--drifts D2] [--compare-direct]
                                           one call through fiks-proxy
  repro --scenario D2 [--target seed-v1] [--runs 3] [--keep]
                                           capture a trace, generate its repro test, run the F gate
  repair --scenario D2 [--base main] [--no-pr] [--model claude-opus-5-5]
                                           repro -> repair agent -> gates -> green CI -> PR (never merges)
  confirm                                  after a human merge: re-run each repaired drift on main
  bench --phase A|B|C --k 5 [--tasks T1,T6] [--model m] [--shop-ref pr-heads] [--direct] [--out dir]
                                           agent trials through fiks-proxy; logs to bench/results/<runId>
  demo [--drifts D1,D2,D3] [--base fresh|main] [--until-f-gate]
                                           the whole loop per drift; prints PR URLs, never merges
  summarize [--check]                      bench/results/summary.json from logs only (--check: rebuild and compare)`;

/**
 * The line(s) of `usage` for one command: its entry line (two-space indent) plus any
 * continuation lines (deeper indent) right after it.
 */
export function usageLines(command: string, usage = USAGE): string {
  const lines = usage.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`  ${command} `) || l === `  ${command}`);
  if (start === -1) throw new Error(`no usage line for ${command}`);
  const out = [lines[start] as string];
  for (let i = start + 1; i < lines.length && /^ {3,}\S/.test(lines[i] as string); i++)
    out.push(lines[i] as string);
  return out.join('\n');
}

/**
 * The ec241bc flag table (every command accepted every flag), plus `--domain` (P8) and
 * `--help` (prints the command's usage line). Unknown flags still throw.
 */
export const OPTIONS = {
  json: { type: 'boolean', default: false },
  vendor: { type: 'string', default: 'v1' },
  out: { type: 'string' },
  drifts: { type: 'string' },
  transport: { type: 'string', default: 'stdio' },
  'compare-direct': { type: 'boolean', default: false },
  scenario: { type: 'string' },
  target: { type: 'string', default: 'seed-v1' },
  runs: { type: 'string', default: '3' },
  keep: { type: 'boolean', default: false },
  base: { type: 'string', default: 'main' },
  'no-pr': { type: 'boolean', default: false },
  model: { type: 'string' },
  trace: { type: 'string' },
  phase: { type: 'string' },
  k: { type: 'string', default: '5' },
  tasks: { type: 'string' },
  'shop-ref': { type: 'string' },
  check: { type: 'boolean', default: false },
  'until-f-gate': { type: 'boolean', default: false },
  direct: { type: 'boolean', default: false },
  'no-receipt-field': { type: 'boolean', default: false },
  domain: { type: 'string' },
  fetch: { type: 'boolean', default: false },
  'run-key': { type: 'string' },
  help: { type: 'boolean', default: false },
} as const;

export function parse(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
}

export type Values = ReturnType<typeof parse>['values'];

export function printer(values: Values) {
  return (data: unknown, human: () => string) => {
    console.log(values.json ? JSON.stringify(data, null, 2) : human());
  };
}

/** For commands that do not take `--domain`: anything but `shop` is an error (exit 2). */
export function shopOnly(command: string, values: Values): void {
  if (values.domain !== undefined && values.domain !== 'shop') {
    console.error(`${command}: --domain ${values.domain} is not supported (shop only)`);
    process.exit(2);
  }
}

/** A legacy adapter: wraps one ec241bc command with its exact flags and output. */
export interface LegacyCommand {
  name: string;
  help(): string;
  // biome-ignore lint/suspicious/noConfusingVoidType: an `async run()` with no return value must fit.
  run(argv: string[]): Promise<number | void>;
}
