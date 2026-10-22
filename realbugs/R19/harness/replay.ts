// One R19 replay: the unmodified mongodb-mcp-server at a built head, over MCP stdio, with its Atlas
// base URL (MDB_MCP_API_BASE_URL) pointed at a plain-HTTP replay of the fixture on 127.0.0.1 (RBX
// process-level replay; see synth-fixtures.ts for why not HTTPS). The result is evaluated against ../contract.json through
// the text projection (./project.ts) at the fixture's capturedAt.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ContractFile,
  type EvalInput,
  type EvalResult,
  evaluate,
  type Recording,
  type ToolContract,
} from '../../../packages/contracts/src/index.ts';
import {
  type MatcherConfig,
  type ProcessReplayed,
  replayRecordingProcess,
  type ServerCommand,
  verdictSummary,
} from '../../../packages/replay-proc/src/index.ts';
import { ADAPTER, serverArgv } from './adapter.ts';
import { BUG_DIR } from './heads.ts';
import { withProjection } from './project.ts';

export const CONTRACT_PATH = join(BUG_DIR, 'contract.json');
/** The property the bug violates (PLAN 5.10 step 5: F names it). */
export const COUNT_PROPERTY = 'mongodb.atlas-list-clusters/count.matchesRows';
export const BASE_URL_ENV = ADAPTER.baseUrlEnv;

/** Strict matching (method, path+query, body, significant header names): no normaliser needed. */
export const MATCHERS: MatcherConfig = {};

export function loadContracts(path = CONTRACT_PATH): ContractFile {
  return JSON.parse(readFileSync(path, 'utf8')) as ContractFile;
}

export function loadFixture(path: string): Recording {
  return JSON.parse(readFileSync(path, 'utf8')) as Recording;
}

/** `evaluate` on the projected result (structuredContent = the text projection). */
export function evaluateProjected(contract: ToolContract | undefined, input: EvalInput): EvalResult {
  return evaluate(contract, { ...input, result: withProjection(input.result) });
}

/**
 * Extra environment for the server (the command line in adapter.json already carries placeholder
 * Atlas credentials, without which Atlas tools are not registered, and `--telemetry disabled`):
 * logs and exports in a temp dir, and every proxy-aware client sent to a closed local port, so
 * nothing but the replay (127.0.0.1, NO_PROXY) is reachable.
 */
export function serverEnv(logDir: string): Record<string, string> {
  return {
    DO_NOT_TRACK: '1',
    MDB_MCP_LOG_PATH: logDir,
    MDB_MCP_EXPORTS_PATH: join(logDir, 'exports'),
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost',
    NODE_USE_ENV_PROXY: '1',
  };
}

export interface RunOutcome {
  verdict: EvalResult['verdict'];
  violated: string[];
  checked: string[];
  unmatched: string[];
  /** The projection the contract saw. */
  reportedCount: unknown;
  rowCount: unknown;
  /** The tool's first text block (the summary line). */
  summary: string;
  countFailure: boolean;
}

export function outcomeOf(r: ProcessReplayed): RunOutcome {
  const s = verdictSummary(r);
  const projected = withProjection(r.result).structuredContent ?? {};
  const first = (r.result.content ?? [])[0] as { text?: unknown } | undefined;
  return {
    verdict: s.verdict,
    violated: s.violated,
    checked: s.checked,
    unmatched: [...r.unmatched],
    reportedCount: projected.reportedCount,
    rowCount: projected.rowCount,
    summary: typeof first?.text === 'string' ? first.text : '',
    countFailure: s.violated.includes(COUNT_PROPERTY),
  };
}

/** adapter.json `serverCommand` in `head`; `node` is this process's node (same runtime). */
export function serverCommand(head: string): ServerCommand {
  const [cmd = 'node', ...args] = serverArgv();
  return { command: cmd === 'node' ? process.execPath : cmd, args, cwd: head };
}

/** Replays `fixture` once through the server built at `head`. */
export async function replayOnce(
  fixture: Recording,
  head: string,
  contracts: ContractFile = loadContracts(),
): Promise<{ outcome: RunOutcome; raw: ProcessReplayed }> {
  const logDir = mkdtempSync(join(tmpdir(), 'fiks-r19-'));
  try {
    const raw = await replayRecordingProcess(fixture, {
      server: serverCommand(head),
      contracts,
      baseUrlEnv: BASE_URL_ENV,
      upstream: { mode: 'http' },
      matchers: MATCHERS,
      clock: 'capture',
      env: serverEnv(logDir),
      evaluate: evaluateProjected,
      spawn: { timeoutMs: 60_000 },
    });
    return { outcome: outcomeOf(raw), raw };
  } finally {
    rmSync(logDir, { recursive: true, force: true });
  }
}
