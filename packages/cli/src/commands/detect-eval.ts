// `fiks detect-eval` (DET; PLAN 6.1 E3): runs detectors over identical CallRecords offline and
// writes DetectorVerdictRows with truth() labels and origin units.
//
//   fiks detect-eval --detectors contracts,b-snap,b-schema[,b-ajv,b-trig,b-stat:aegis:20,...]
//                    --inputs <records dir>[,<dir>...] --out <dir> [--contracts <file>]
//                    [--per-element] [--reference <v1 records dir>] [--replays n] [--json]
//
// `contracts` = the frozen contract evaluator through MON's offline replay (now := capturedAt).
// Baselines come from @fiks/baselines (BASE). B-SNAP and B-STAT take their v1 reference from the
// inputs' controls.jsonl (or --reference). Every input record is evaluated: calls.jsonl rows
// (role `call`) and controls.jsonl rows (role `control`), in file order. `--replays n` repeats
// the whole evaluation n times and fails (exit 1) unless every replay gives byte-identical rows.
// R2 passes paper/results/raw/detect as --out; tests pass $TMPDIR.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type BaselineMonitor,
  buildSnapshot,
  createAjvMonitor,
  createSchemaMonitor,
  createSnapMonitor,
  createStatMonitor,
  createTrigMonitor,
  runDetector,
  type StatMode,
} from '@fiks/baselines';
import type { ContractFile } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import {
  CALLS_FILE,
  CONTROLS_FILE,
  callEvent,
  type DetCallRecord,
  MANIFEST_FILE,
  type RecordManifest,
  readJsonl,
  sha256Hex,
  toJsonl,
  truthLabel,
  writeJson,
  writeJsonl,
} from '@fiks/frame';
import type { CliCommandModule, DetectorVerdictRow, MonitorToolDef } from '@fiks/interfaces';
import { contractsMonitor, normalizeRecord, type ReplayRecord, replayAll } from '@fiks/proxy';

export const DETECTORS = ['contracts', 'b-schema', 'b-ajv', 'b-snap', 'b-trig', 'b-stat'] as const;

export interface EvalRow extends DetectorVerdictRow {
  inputId: string;
  role: 'call' | 'control';
  mutant: string | null;
  truthLabel: string;
}

interface Loaded {
  records: DetCallRecord[];
  roles: Map<string, 'call' | 'control'>;
  reference: DetCallRecord[];
  contractsPath: string | null;
}

function loadInputs(dirs: string[], referenceDir?: string): Loaded {
  const records: DetCallRecord[] = [];
  const roles = new Map<string, 'call' | 'control'>();
  const reference: DetCallRecord[] = [];
  let contractsPath: string | null = null;
  for (const dir of dirs) {
    const mf = join(dir, MANIFEST_FILE);
    if (existsSync(mf)) {
      const m = JSON.parse(readFileSync(mf, 'utf8')) as RecordManifest;
      contractsPath ??= m.contracts?.path ?? null;
    }
    for (const [file, role] of [
      [CALLS_FILE, 'call'],
      [CONTROLS_FILE, 'control'],
    ] as const) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      for (const r of readJsonl<DetCallRecord>(path)) {
        records.push(r);
        roles.set(r.callId, role);
        if (role === 'control' && !referenceDir) reference.push(r);
      }
    }
  }
  if (referenceDir) {
    for (const f of [CALLS_FILE, CONTROLS_FILE]) {
      const path = join(resolve(referenceDir), f);
      if (existsSync(path)) reference.push(...readJsonl<DetCallRecord>(path));
    }
  }
  return { records, roles, reference, contractsPath };
}

function toolDefsOf(records: DetCallRecord[]): Record<string, MonitorToolDef> {
  const out: Record<string, MonitorToolDef> = {};
  for (const r of records) {
    const def = callEvent(r)?.toolDef as MonitorToolDef | undefined;
    if (def && !out[r.tool]) out[r.tool] = def;
  }
  return out;
}

async function baselineFor(
  name: string,
  l: Loaded,
): Promise<(BaselineMonitor & { close?(): Promise<void> }) | null> {
  if (name === 'b-schema') return createSchemaMonitor();
  if (name === 'b-ajv') return createAjvMonitor();
  if (name === 'b-trig') return createTrigMonitor({});
  if (name === 'b-snap') return createSnapMonitor(buildSnapshot(l.reference));
  const stat = /^b-stat(?::(aegis|evidently))?(?::w?(\d+))?$/.exec(name);
  if (stat) {
    return createStatMonitor({
      mode: (stat[1] ?? 'aegis') as StatMode,
      window: Number(stat[2] ?? 20),
      reference: l.reference,
    });
  }
  return null;
}

async function evaluateOnce(
  detectors: string[],
  l: Loaded,
  contracts: ContractFile,
  perElement: boolean,
): Promise<EvalRow[]> {
  const byId = new Map(l.records.map((r) => [r.callId, r]));
  const extra = (row: DetectorVerdictRow): EvalRow => {
    const r = byId.get(row.callId) as DetCallRecord;
    return {
      ...row,
      inputId: r.inputId,
      role: l.roles.get(r.callId) ?? 'call',
      mutant: r.mutant,
      truthLabel: truthLabel(r.truth),
    };
  };
  const rows: EvalRow[] = [];
  for (const name of detectors) {
    if (name === 'contracts') {
      const replayRecords = l.records.map(
        (r, i) => normalizeRecord(r, `record ${i}`, { domain: r.domain, stratum: r.stratum }) as ReplayRecord,
      );
      const run = await replayAll(replayRecords, {
        monitor: contractsMonitor(),
        contracts,
        ...(perElement ? { opts: { perElement: true } } : {}),
      });
      rows.push(...run.rows.map(extra));
      continue;
    }
    const monitor = await baselineFor(name, l);
    if (!monitor)
      throw new Error(`unknown detector ${name} (known: ${DETECTORS.join(', ')}, b-stat:<mode>:<w>)`);
    try {
      const detected = await runDetector(monitor, l.records, { toolDefs: toolDefsOf(l.records), contracts });
      rows.push(...detected.map((d) => extra(d.row)));
    } finally {
      await monitor.close?.();
    }
  }
  return rows;
}

export interface DetectEvalResult {
  out: string;
  rows: EvalRow[];
  sha256: string;
  replays: number;
  distinctHashes: number;
}

export async function runDetectEval(opts: {
  detectors: string[];
  inputs: string[];
  out: string;
  contracts?: string;
  perElement?: boolean;
  reference?: string;
  replays?: number;
}): Promise<DetectEvalResult> {
  const l = loadInputs(
    opts.inputs.map((d) => resolve(d)),
    opts.reference,
  );
  if (!l.records.length) throw new Error(`detect-eval: no CallRecords in ${opts.inputs.join(', ')}`);
  const contractsPath =
    opts.contracts ?? l.contractsPath ?? getDomain(l.records[0]?.domain ?? 'shop').contractsPath;
  const contracts = JSON.parse(readFileSync(contractsPath, 'utf8')) as ContractFile;
  const replays = Math.max(1, opts.replays ?? 1);
  const hashes = new Set<string>();
  let rows: EvalRow[] = [];
  for (let i = 0; i < replays; i++) {
    rows = await evaluateOnce(opts.detectors, l, contracts, opts.perElement === true);
    hashes.add(sha256Hex(toJsonl(rows)));
  }
  const out = resolve(opts.out);
  const sha256 = writeJsonl(join(out, 'rows.jsonl'), rows);
  const perDetector: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const d = perDetector[r.detector] ?? {};
    perDetector[r.detector] = d;
    d[r.verdict] = (d[r.verdict] ?? 0) + 1;
  }
  writeJson(join(out, 'summary.json'), {
    detectors: opts.detectors,
    inputs: opts.inputs.map((d) => resolve(d)),
    contracts: { path: resolve(contractsPath), sha256: sha256Hex(readFileSync(contractsPath)) },
    records: l.records.length,
    rows: rows.length,
    rowsSha256: sha256,
    replays,
    distinctHashes: hashes.size,
    perDetector,
  });
  return { out, rows, sha256, replays, distinctHashes: hashes.size };
}

const USAGE =
  'detect-eval --detectors contracts,b-snap,b-schema,... --inputs <dir>[,<dir>...] --out <dir> [--contracts <file>] [--per-element] [--reference <dir>] [--replays n] [--json]';

const command: CliCommandModule = {
  name: 'detect-eval',
  describe: 'Run detectors over identical CallRecords with truth() labels (DET, PLAN 6.1)',
  async run(argv) {
    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          detectors: { type: 'string' },
          inputs: { type: 'string' },
          out: { type: 'string' },
          contracts: { type: 'string' },
          'per-element': { type: 'boolean', default: false },
          reference: { type: 'string' },
          replays: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      console.error(`${(e as Error).message}\nusage: fiks ${USAGE}`);
      return 2;
    }
    if (!values.detectors || !values.inputs || !values.out) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    try {
      const r = await runDetectEval({
        detectors: (values.detectors as string).split(',').filter(Boolean),
        inputs: (values.inputs as string).split(',').filter(Boolean),
        out: values.out as string,
        contracts: values.contracts as string | undefined,
        perElement: values['per-element'] === true,
        reference: values.reference as string | undefined,
        replays: values.replays ? Number(values.replays) : 1,
      });
      const msg = `wrote ${r.rows.length} rows to ${join(r.out, 'rows.jsonl')} (sha256 ${r.sha256}); ${r.replays} replays, ${r.distinctHashes} distinct row hash(es)`;
      if (values.json)
        console.log(
          JSON.stringify({
            out: r.out,
            rows: r.rows.length,
            sha256: r.sha256,
            replays: r.replays,
            distinctHashes: r.distinctHashes,
          }),
        );
      else console.log(msg);
      return r.distinctHashes === 1 ? 0 : 1;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 2;
    }
  },
};

export default command;
