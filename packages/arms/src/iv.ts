// Issue validation (PLAN 3.0 "Issue validation", P21): replay the frozen trace on a head through
// the frozen contracts and evaluate the triggering tool's ivProperties.
//
// The head's own server process is started over MCP stdio with its upstream pointed at a strict
// replay of the trace's recorded exchanges (packages/replay-proc, the same request key as the
// repo's test/fiks/replay.ts and the same clock rule as test/fiks/run.ts: the server runs 10
// years after capture, contracts are evaluated at `capturedAt`). The contract is fiks's frozen
// copy, evaluated by fiks's own evaluator, never anything in the head.
//
// IV fails when, on the replayed frozen call:
//  - an evaluated property is violated (with `--properties`: only ivProperties are evaluated;
//    without it every property of the contract is);
//  - the head makes an upstream request the trace never recorded (UNMATCHED_REQUEST): the caller
//    re-records the trace first when the head changes its requests (P23), so this means the
//    re-recording did not apply;
//  - the frozen call returned data and the head now returns an error (refusing is not repairing,
//    as in the repo's expectRecordingHolds);
//  - an evaluated target property of the trace was not evaluated at all (as P's mustCheck).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ContractFile, findContract, SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import type { Domain, IvExclusion } from '@fiks/interfaces';
import { replayRecordingProcess } from '@fiks/replay-proc';
import type { IvSidecar } from './sidecar.ts';
import { type FrozenTraceFile, traceTarget } from './trace.ts';

export interface IvFailure {
  propertyId: string;
  message: string;
}

export interface IvResult {
  pass: boolean;
  tool: string;
  contractId: string | null;
  /** Property ids IV evaluates (`all` = every property of the contract, no sidecar). */
  evaluated: string[] | 'all';
  failures: IvFailure[];
  /** From the sidecar: properties not evaluated, with their verdict on the v1 control. */
  excluded: IvExclusion[];
  /** Property ids the evaluator actually checked on the replayed call. */
  checked: string[];
  /** Every violation on the replayed call, evaluated or not (for logs). */
  violatedAll: string[];
  unmatched: string[];
}

/** Synthetic ids for failures that are not contract properties. */
export const IV_UNMATCHED = 'iv/UNMATCHED_REQUEST';
export const IV_ERROR_INSTEAD_OF_DATA = 'iv/error-instead-of-data';
export const IV_REPLAY_ERROR = 'iv/replay-error';

/** The frozen contracts of a domain: shop = packages/contracts; others = Domain.contractsPath. */
export function defaultContractsPath(domain: string, d?: Domain): string {
  if (domain === 'shop') return SHOP_CONTRACTS_PATH;
  if (!d) throw new Error(`no contracts path for domain ${domain}`);
  return d.contractsPath;
}

export function loadContracts(file: string): ContractFile {
  const c = JSON.parse(readFileSync(file, 'utf8')) as ContractFile;
  if (!Array.isArray(c?.contracts)) throw new Error(`${file} is not a contract file`);
  return c;
}

export interface IvInput {
  trace: FrozenTraceFile;
  /** The candidate head (a checkout of the target repo with its dependencies installed). */
  head: string;
  contracts: ContractFile;
  /** The Domain (server command, base-URL env); shop defaults apply when it is not registered. */
  domain?: Domain;
  sidecar?: IvSidecar;
  timeoutMs?: number;
}

export async function issueValidation(input: IvInput): Promise<IvResult> {
  const { trace, head, contracts, sidecar } = input;
  const contract = findContract(contracts, trace.tool);
  const base: Omit<IvResult, 'pass' | 'failures' | 'checked' | 'violatedAll' | 'unmatched'> = {
    tool: trace.tool,
    contractId: contract?.id ?? null,
    evaluated: sidecar ? [...sidecar.ivProperties] : 'all',
    excluded: sidecar ? sidecar.ivExcluded.map((e) => ({ ...e })) : [],
  };
  if (!contract) {
    return {
      ...base,
      pass: false,
      failures: [
        { propertyId: IV_REPLAY_ERROR, message: `the frozen contracts have no contract for ${trace.tool}` },
      ],
      checked: [],
      violatedAll: [],
      unmatched: [],
    };
  }
  if (sidecar) {
    const foreign = sidecar.ivProperties.filter((p) => !p.startsWith(`${contract.id}/`));
    if (foreign.length)
      throw new Error(
        `IV sidecar names properties of another contract than ${contract.id}: ${foreign.join(', ')}`,
      );
  }
  const server = input.domain?.serverCommand(head) ?? {
    command: join(head, 'node_modules/.bin/tsx'),
    args: ['src/main.ts'],
    cwd: head,
  };
  let replayed: Awaited<ReturnType<typeof replayRecordingProcess>>;
  try {
    replayed = await replayRecordingProcess(trace, {
      server,
      contracts,
      baseUrlEnv: input.domain?.baseUrlEnv ?? 'VENDOR_BASE_URL',
      spawn: { timeoutMs: input.timeoutMs ?? 180_000 },
    });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 6).join('\n');
    return {
      ...base,
      pass: false,
      failures: [{ propertyId: IV_REPLAY_ERROR, message: `the head could not replay the trace: ${message}` }],
      checked: [],
      violatedAll: [],
      unmatched: [],
    };
  }
  const evaluated = sidecar ? new Set(sidecar.ivProperties) : undefined;
  const inScope = (p: string) => !evaluated || evaluated.has(p);
  const failures: IvFailure[] = [];
  if (replayed.unmatched.length) {
    failures.push({
      propertyId: IV_UNMATCHED,
      message: `the head makes upstream requests the trace never recorded: ${replayed.unmatched.join('; ')}`,
    });
  }
  const recordedData = trace.result !== undefined && !trace.result.isError;
  if (recordedData && replayed.result.isError) {
    const text = (replayed.result.content as { text?: string }[] | undefined)
      ?.map((c) => c.text ?? '')
      .join(' ')
      .slice(0, 300);
    failures.push({
      propertyId: IV_ERROR_INSTEAD_OF_DATA,
      message: `the tool now returns an error instead of data: ${text ?? ''}`.trim(),
    });
  }
  for (const v of replayed.evaluation.violations) {
    if (inScope(v.propertyId)) failures.push({ propertyId: v.propertyId, message: v.message });
  }
  if (!replayed.unmatched.length && !(recordedData && replayed.result.isError)) {
    for (const t of traceTarget(trace)) {
      if (inScope(t) && !replayed.evaluation.checked.includes(t))
        failures.push({ propertyId: t, message: `${t} was not evaluated on the replayed call` });
    }
  }
  return {
    ...base,
    pass: failures.length === 0,
    failures,
    checked: [...replayed.evaluation.checked],
    violatedAll: replayed.evaluation.violations.map((v) => v.propertyId),
    unmatched: [...replayed.unmatched],
  };
}

/** The lines fiks-iv prints (the property id and message of each failure are what L1/COMP see). */
export function formatIvResult(r: IvResult, label?: string): string {
  const out: string[] = [];
  const n = r.evaluated === 'all' ? 'every property' : `${r.evaluated.length} ivProperties`;
  out.push(`fiks-iv: ${r.tool}${label ? ` ${label}` : ''} (contract ${r.contractId ?? '-'}; ${n})`);
  if (r.excluded.length)
    out.push(
      `ivExcluded: ${r.excluded.map((e) => `${e.property} (control: ${e.controlVerdict})`).join(', ')}`,
    );
  for (const f of r.failures) out.push(`IV FAIL ${f.propertyId}: ${f.message}`);
  if (r.pass) out.push(`IV PASS (${r.checked.length} checked)`);
  return `${out.join('\n')}\n`;
}
