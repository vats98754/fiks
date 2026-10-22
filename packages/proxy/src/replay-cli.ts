#!/usr/bin/env node
// Offline replay of recorded tool calls through a monitor (paper/PLAN.md P9).
//
//   replay-cli --in <file|dir>... --out <rows.jsonl> [--monitor contracts|<module>]
//              [--contracts <file>] [--tools <file>] [--reenable <id,...>] [--per-element]
//              [--domain <id>] [--stratum <name>]
//   replay-cli --check <file|dir>... [--monitor contracts] [--contracts <file>] [--tools <file>]
//
// Every record is evaluated with now := new Date(record.at ?? record.capturedAt); the system
// clock is never read, and a record with neither field is refused (exit 2). `--in` writes one
// DetectorVerdictRow per violation (per violating element with --per-element), else one per
// record. `--check` rebuilds each logged receipt and exits 1 unless every verdict (verdict,
// contractId, checked, violations, disabled) is byte-identical; it also reports which other
// receipt fields (e.g. hints, absent from receipts logged before 705e989) differ.
// Exit codes: 0 ok, 1 check mismatch, 2 bad input or usage.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ContractFile, SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import type { MonitorOptions } from '@fiks/interfaces';
import { contractsMonitor, type EvaluateFn, loadMonitor, NO_MONITOR } from './monitor.ts';
import { checkReceipts, readRecords, readTools, replayAll, SHOP_TOOLS_PATH } from './replay.ts';

const USAGE =
  'usage: replay-cli (--in <file|dir>... --out <rows.jsonl> | --check <file|dir>...) [--monitor contracts|<module>] [--contracts <file>] [--tools <file>] [--reenable <id,...>] [--per-element] [--domain <id>] [--stratum <name>]';

export interface ReplayCliIo {
  log: (line: string) => void;
  error: (line: string) => void;
  /** Injectable contract evaluator (tests spy on the options it receives). */
  evaluate?: EvaluateFn;
}

/** Runs the CLI; returns the exit code. */
export async function runReplayCli(argv: string[], io: ReplayCliIo = defaultIo): Promise<number> {
  let values: {
    in?: string[];
    out?: string;
    check?: string[];
    monitor: string;
    contracts?: string;
    tools?: string;
    reenable?: string;
    'per-element': boolean;
    domain: string;
    stratum: string;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        in: { type: 'string', multiple: true },
        out: { type: 'string' },
        check: { type: 'string', multiple: true },
        monitor: { type: 'string', default: 'contracts' },
        contracts: { type: 'string' },
        tools: { type: 'string' },
        reenable: { type: 'string' },
        'per-element': { type: 'boolean', default: false },
        domain: { type: 'string', default: 'shop' },
        stratum: { type: 'string', default: 'unknown' },
      },
    }));
  } catch (e) {
    io.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  const checking = Boolean(values.check?.length);
  if (checking === Boolean(values.in?.length) || (!checking && !values.out)) {
    io.error(USAGE);
    return 2;
  }
  if (values.monitor === NO_MONITOR) {
    io.error('--monitor none: replay needs a monitor (contracts or a module)');
    return 2;
  }
  const reenable = values.reenable
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const opts: MonitorOptions = {
    ...(reenable?.length ? { reenable } : {}),
    ...(values['per-element'] ? { perElement: true } : {}),
  };
  if (checking && Object.keys(opts).length) {
    io.error('--check compares with live receipts, which never use --reenable or --per-element');
    return 2;
  }

  try {
    const monitor =
      values.monitor === 'contracts' && io.evaluate
        ? contractsMonitor(io.evaluate)
        : await loadMonitor(values.monitor);
    if (monitor === NO_MONITOR) return 2;
    const contractsPath = values.contracts ?? SHOP_CONTRACTS_PATH;
    const contracts = JSON.parse(readFileSync(contractsPath, 'utf8')) as ContractFile;
    // The shop snapshot is the default only for the default (shop) contracts.
    const toolsPath = values.tools ?? (values.contracts ? undefined : SHOP_TOOLS_PATH);
    const tools = toolsPath ? readTools(toolsPath) : undefined;
    const inputs = (checking ? values.check : values.in) ?? [];
    const { records, skipped, files } = readRecords(
      inputs.map((p) => resolve(p)),
      { domain: values.domain, stratum: values.stratum },
    );
    if (!records.length) {
      io.error(`no call records in ${inputs.join(', ')} (${files.length} files, ${skipped} other lines)`);
      return 2;
    }
    const run = await replayAll(records, { monitor, contracts, tools, opts });

    if (checking) {
      const c = checkReceipts(run.replayed);
      for (const m of c.mismatches.slice(0, 20)) {
        io.error(`MISMATCH ${m.callId}\n  logged:   ${m.logged}\n  replayed: ${m.replayed}`);
      }
      const other = Object.entries(c.otherFieldDiffs)
        .map(([k, n]) => `${k} x${n}`)
        .join(', ');
      io.log(
        `checked ${c.compared} logged receipts in ${files.length} files: verdicts ${c.identical} byte-identical, ${c.mismatches.length} different; whole receipt ${c.receiptIdentical} byte-identical${other ? ` (other fields differ: ${other})` : ''}; ${c.unlogged} records had no receipt`,
      );
      return c.compared > 0 && c.mismatches.length === 0 ? 0 : 1;
    }

    const out = values.out as string;
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, run.rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    io.log(`replayed ${records.length} records -> ${run.rows.length} rows in ${out}`);
    return 0;
  } catch (e) {
    io.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

const defaultIo: ReplayCliIo = { log: (l) => console.log(l), error: (l) => console.error(l) };

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = await runReplayCli(process.argv.slice(2));
}
