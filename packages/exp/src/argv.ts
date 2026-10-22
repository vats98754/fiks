// argv templates for the commands a run step invokes: 'pnpm fiks repair' (FIKS, FIKS+CU; product
// mode for R11), 'pnpm fiks arm' (every comparator arm), 'pnpm fiks grade' and 'pnpm fiks record'.
// Every experiment arm argv carries --trace and --base (PLAN 6.2: the same frozen trace and a local
// base ref) and never --fetch (P17); experiment mode is always --ci local --no-pr with a run key.

import { formatRunKey, type RunKey, type TraceFormat } from '@fiks/interfaces';
import type { DriftInput } from './inputs.ts';

export const ARMS = [
  'FIKS',
  'FIKS+CU',
  'L1',
  'L1-noIV',
  'L1p',
  'COMP',
  'COMP-norep',
  'COMP-plain',
  'REPRO-AGENT',
  'ISSUE-TEXT',
] as const;
export type ArmName = (typeof ARMS)[number];

export interface ArmCall {
  arm: ArmName;
  runKey: RunKey;
  drift: DriftInput;
  /** Frozen trace path (the same file for every arm of the block). */
  trace: string;
  traceFormat?: TraceFormat;
  /** --dry: the SAFE stub-runner script. */
  agentStub?: string;
  /** Command prefix for the fiks CLI (default ['pnpm', 'fiks']). */
  fiks: string[];
}

export function armArgv(c: ArmCall): string[] {
  const common = [
    '--domain',
    c.drift.domain,
    '--trace',
    c.trace,
    '--base',
    c.drift.base,
    '--run-key',
    formatRunKey(c.runKey),
    '--ci',
    'local',
    '--no-pr',
  ];
  const tail = [
    ...(c.traceFormat ? ['--trace-format', c.traceFormat] : []),
    ...(c.agentStub ? ['--agent-stub', c.agentStub] : []),
  ];
  let argv: string[];
  if (c.arm === 'FIKS') argv = [...c.fiks, 'repair', '--arm', 'fiks', ...common, ...tail];
  else if (c.arm === 'FIKS+CU') {
    if (!c.drift.cleanCorpus)
      throw new Error(`FIKS+CU on ${c.drift.id} needs a clean v1 corpus (--clean-corpus)`);
    argv = [
      ...c.fiks,
      'repair',
      '--arm',
      'fiks+cu',
      ...common,
      '--clean-corpus',
      c.drift.cleanCorpus,
      ...tail,
    ];
  } else if (c.arm === 'ISSUE-TEXT') {
    if (!c.drift.issue) throw new Error(`ISSUE-TEXT on ${c.drift.id} needs an issue file`);
    argv = [...c.fiks, 'arm', '--name', c.arm, ...common, '--issue', c.drift.issue, ...tail];
  } else argv = [...c.fiks, 'arm', '--name', c.arm, ...common, ...tail];
  assertArmArgv(argv);
  return argv;
}

/** PLAN 6.2 / P17 invariants of every experiment arm argv. */
export function assertArmArgv(argv: string[]): void {
  const val = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  for (const f of ['--trace', '--base', '--run-key']) {
    const v = val(f);
    if (!v || v.startsWith('--')) throw new Error(`arm argv lacks ${f}: ${argv.join(' ')}`);
  }
  if (argv.some((a) => a === '--fetch' || a.startsWith('--fetch=')))
    throw new Error(`arm argv must never carry --fetch: ${argv.join(' ')}`);
  if (val('--ci') !== 'local' || !argv.includes('--no-pr'))
    throw new Error(`experiment arm argv must be --ci local --no-pr: ${argv.join(' ')}`);
}

/** `pnpm fiks record --drift` + `freeze-trace` for one dev drift (the prepare phase, DET). */
export function prepareArgvs(
  fiks: string[],
  d: DriftInput,
  dir: string,
): { key: string; argv: string[]; trace: string }[] {
  if (!d.recordPkg) throw new Error(`${d.id}: no DriftPackage to record from`);
  const enumFile = `${dir}/enum.jsonl`;
  const records = `${dir}/records`;
  const trace = `${dir}/trace.json`;
  return [
    {
      key: `${d.id}/enumerate`,
      argv: [...fiks, 'enumerate', '--drift', d.recordPkg, '--seed', `exp-${d.id}`, '--out', enumFile],
      trace,
    },
    {
      key: `${d.id}/record`,
      argv: [
        ...fiks,
        'record',
        '--domain',
        d.domain,
        '--drift',
        d.recordPkg,
        '--in',
        enumFile,
        '--out',
        records,
      ],
      trace,
    },
    {
      key: `${d.id}/freeze-trace`,
      argv: [...fiks, 'freeze-trace', '--records', records, '--out', trace],
      trace,
    },
  ];
}

/** `pnpm fiks grade` of one final head against the drift's held-out package (HOLD). */
export function gradeArgv(
  fiks: string[],
  o: { pkg: string; patch: string; toolsImage: string; out: string; runKey: string },
): string[] {
  return [
    ...fiks,
    'grade',
    '--pkg',
    o.pkg,
    '--patch',
    o.patch,
    '--id',
    o.runKey,
    '--tools-image',
    o.toolsImage,
    '--json',
    '--out',
    o.out,
  ];
}

/**
 * R11 (D10 showcase, product mode): no --arm, no --run-key and no --no-pr, so SAFE's P5 base-owner
 * allow-list applies and a PR is opened against `showcase/<driftId>`; --ci github.
 */
export function showcaseArgv(fiks: string[], d: DriftInput): string[] {
  if (!d.trace) throw new Error(`${d.id}: no frozen trace`);
  const argv = [
    ...fiks,
    'repair',
    '--trace',
    d.trace,
    '--base',
    `showcase/${d.id}`,
    '--domain',
    d.domain,
    '--ci',
    'github',
  ];
  for (const f of ['--arm', '--run-key', '--no-pr', '--fetch'])
    if (argv.includes(f)) throw new Error(`R11 argv must not carry ${f}`);
  return argv;
}
