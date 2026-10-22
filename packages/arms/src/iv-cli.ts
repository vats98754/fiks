#!/usr/bin/env node
// fiks-iv (PLAN P21): issue validation of a candidate head against a frozen trace.
//
//   fiks-iv --trace <trace.json> [--head <dir>] [--domain <id>] [--contracts <file>]
//           [--properties <trace>.iv.json] [--run-key <exp/arm/model/domain/drift/attempt>] [--json]
//
// Exit 0: every evaluated property holds on the replayed frozen call. Exit 1: IV failed; each
// failure is printed as `IV FAIL <property id>: <message>`. Exit 2: usage error, an invalid
// sidecar, or experiment mode (--run-key) without --properties ("IV sidecar required").
//
// With --properties only the sidecar's ivProperties are evaluated (the triggering tool's contract
// properties that verify on the frozen call's v1 control) and ivExcluded is printed. Arms run it
// inside the per-attempt container, after `fiks rerecord-head --check IV` re-recorded the trace
// when the head changes its requests (P23).
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseRunKey } from '@fiks/interfaces';
import { resolveDomain } from './domains.ts';
import { defaultContractsPath, formatIvResult, issueValidation, loadContracts } from './iv.ts';
import { type IvSidecar, loadSidecar } from './sidecar.ts';
import { loadFrozenTrace, traceDomain } from './trace.ts';

export const IV_USAGE =
  'fiks-iv --trace <trace.json> [--head <dir>] [--domain <id>] [--contracts <file>] [--properties <trace>.iv.json] [--run-key <key>] [--json]';

export interface IvCliIo {
  out(s: string): void;
  err(s: string): void;
}

const stdio: IvCliIo = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

export async function ivMain(argv: string[], io: IvCliIo = stdio): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      options: {
        trace: { type: 'string' },
        head: { type: 'string' },
        domain: { type: 'string' },
        contracts: { type: 'string' },
        properties: { type: 'string' },
        'run-key': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }).values;
  } catch (e) {
    io.err(`fiks-iv: ${e instanceof Error ? e.message : String(e)}\nusage: ${IV_USAGE}\n`);
    return 2;
  }
  if (values.help) {
    io.out(`usage: ${IV_USAGE}\n`);
    return 0;
  }
  if (typeof values.trace !== 'string') {
    io.err(`fiks-iv: --trace is required\nusage: ${IV_USAGE}\n`);
    return 2;
  }
  const runKey = values['run-key'];
  if (typeof runKey === 'string') {
    try {
      parseRunKey(runKey);
    } catch (e) {
      io.err(`fiks-iv: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
    if (typeof values.properties !== 'string') {
      io.err(
        'fiks-iv: IV sidecar required: experiment mode (--run-key) evaluates only the ivProperties of --properties <trace>.iv.json\n',
      );
      return 2;
    }
  }
  let sidecar: IvSidecar | undefined;
  try {
    const loaded = loadFrozenTrace(resolve(values.trace));
    if (typeof values.properties === 'string') sidecar = loadSidecar(resolve(values.properties));
    const domainId = typeof values.domain === 'string' ? values.domain : traceDomain(loaded.trace);
    const domain = await resolveDomain(domainId).catch((e: unknown) => {
      if (domainId === 'shop') return undefined; // shop defaults, without the CLI bootstrap
      throw e;
    });
    const contracts = loadContracts(
      typeof values.contracts === 'string'
        ? resolve(values.contracts)
        : defaultContractsPath(domainId, domain),
    );
    const head = resolve(typeof values.head === 'string' ? values.head : process.cwd());
    const r = await issueValidation({ trace: loaded.trace, head, contracts, domain, sidecar });
    if (values.json) io.out(`${JSON.stringify(r)}\n`);
    else io.out(formatIvResult(r, `on ${head}`));
    return r.pass ? 0 : 1;
  } catch (e) {
    io.err(`fiks-iv: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ivMain(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`fiks-iv: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exitCode = 2;
    },
  );
}
