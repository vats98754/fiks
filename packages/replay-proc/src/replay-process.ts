// Process-level replay: run a recorded tool call through an unmodified MCP server process whose
// upstream is the replay (base-URL override, or the HTTPS shim for hard-coded hosts), over MCP
// stdio, and evaluate the result with the outcome contract at the recording's `capturedAt`.
// Same semantics as the shop-mcp in-process harness (test/fiks/run.ts `replayRecording`).
import {
  buildProbeArgs,
  type ContractFile,
  type EvalInput,
  type EvalResult,
  evaluate as evaluateContract,
  findContract,
  type HttpExchange,
  type JsonSchema,
  type Recording,
  type ToolContract,
} from '@fiks/contracts';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type CertificateAuthority, createCertificateAuthority, localTls, startHttpsShim } from './https.ts';
import type { MatcherConfig } from './matchers.ts';
import { type ReplayServer, replayServer } from './replay-server.ts';
import { type McpStdioServer, type ServerCommand, type SpawnOptions, spawnServer } from './spawn.ts';

/** The in-process harness runs the tool 10 years after capture (contracts at capturedAt). */
export const CLOCK_SKEW_MS = 10 * 365 * 86_400_000;

export type UpstreamMode =
  /** Base-URL override to a plain-HTTP replay (default). */
  | { mode: 'http' }
  /** Base-URL override to an HTTPS replay on 127.0.0.1, trusted through a throwaway CA. */
  | { mode: 'https' }
  /** Hard-coded upstream hosts, intercepted by the HTTPS shim (CONNECT proxy). */
  | { mode: 'proxy'; hosts: string[] };

export interface ProcessReplayOptions {
  server: ServerCommand | string[];
  contracts: ContractFile;
  /** Env var the server reads its upstream base URL from (e.g. VENDOR_BASE_URL). */
  baseUrlEnv?: string;
  /** Appended to the replay URL in `baseUrlEnv` (e.g. `/v1`). */
  basePath?: string;
  upstream?: UpstreamMode;
  matchers?: MatcherConfig;
  /** Extra env for the server process. */
  env?: Record<string, string>;
  /**
   * The server process's clock (Node servers, via a preload): `skew` (default) = capturedAt +
   * 10 years, as in the in-process harness; `capture` = capturedAt; `real` = untouched.
   */
  clock?: 'skew' | 'capture' | 'real';
  /** Contract evaluator (default `@fiks/contracts` `evaluate`), e.g. a target repo's vendored one. */
  evaluate?: (contract: ToolContract | undefined, input: EvalInput) => EvalResult;
  spawn?: SpawnOptions;
}

export interface ProcessReplayed {
  result: CallToolResult;
  probe?: { tool: string; args: Record<string, unknown>; result: CallToolResult; upstream: HttpExchange[] };
  evaluation: EvalResult;
  /** Requests the server made that the recording does not hold. */
  unmatched: string[];
  /** Destinations the HTTPS shim refused (proxy mode). */
  denied: string[];
  served: HttpExchange[];
  stderr: string;
}

const PRELOAD = new URL('./clock-preload.mjs', import.meta.url);

function clockEnv(rec: Recording, clock: ProcessReplayOptions['clock']): Record<string, string> {
  if (clock === 'real') return {};
  const at = Date.parse(rec.capturedAt);
  if (!Number.isFinite(at)) throw new Error(`recording ${rec.id} has no valid capturedAt`);
  const ms = clock === 'capture' ? at : at + CLOCK_SKEW_MS;
  return { FIKS_REPLAY_NOW_MS: String(ms), NODE_OPTIONS: `--import ${PRELOAD.href}` };
}

/** Replays one recording (call + read-after-write probe) through a fresh server process. */
export async function replayRecordingProcess(
  rec: Recording,
  opts: ProcessReplayOptions,
): Promise<ProcessReplayed> {
  const mode = opts.upstream ?? { mode: 'http' };
  const evaluate = opts.evaluate ?? evaluateContract;
  let ca: CertificateAuthority | undefined;
  let replay: ReplayServer | undefined;
  let shim: Awaited<ReturnType<typeof startHttpsShim>> | undefined;
  let server: McpStdioServer | undefined;
  try {
    const env: Record<string, string> = { ...clockEnv(rec, opts.clock) };
    if (mode.mode === 'http') {
      replay = await replayServer([rec], { matchers: opts.matchers });
    } else {
      ca = createCertificateAuthority();
      if (mode.mode === 'https') {
        const t = localTls(ca);
        replay = await replayServer([rec], { matchers: opts.matchers, tls: t.tls });
        Object.assign(env, t.env);
      } else {
        replay = await replayServer([rec], { matchers: opts.matchers });
        shim = await startHttpsShim({ hosts: mode.hosts, handle: replay.handle, ca });
        Object.assign(env, shim.env);
      }
    }
    if (opts.baseUrlEnv) env[opts.baseUrlEnv] = `${replay.url}${opts.basePath ?? ''}`;
    // Caller env last, but NODE_OPTIONS keeps the clock preload.
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      env[k] = k === 'NODE_OPTIONS' && env.NODE_OPTIONS ? `${v} ${env.NODE_OPTIONS}` : v;
    }
    server = await spawnServer(opts.server, env, opts.spawn);
    const tools = await server.listTools();
    const declared = tools.find((t) => t.name === rec.tool)?.outputSchema as JsonSchema | undefined;
    const contract = findContract(opts.contracts, rec.tool);
    const post = contract?.postconditions?.[0];

    const result = await server.callTool(rec.tool, rec.args);
    const upstream = [...replay.served];
    let probe: ProcessReplayed['probe'];
    if (post && result.structuredContent && !result.isError) {
      const args = buildProbeArgs(post, result.structuredContent);
      const before = replay.served.length;
      const probeResult = await server.callTool(post.probeTool, args);
      probe = { tool: post.probeTool, args, result: probeResult, upstream: replay.served.slice(before) };
    }
    const evaluation = evaluate(contract, {
      args: rec.args,
      result,
      now: new Date(rec.capturedAt),
      declaredOutputSchema: declared,
      probe,
      upstream,
    });
    return {
      result,
      probe,
      evaluation,
      unmatched: [...replay.unmatched],
      denied: [...(shim?.denied ?? [])],
      served: [...replay.served],
      stderr: server.stderr(),
    };
  } finally {
    await server?.close();
    await shim?.close();
    await replay?.close();
    ca?.dispose();
  }
}

export interface VerdictSummary {
  verdict: EvalResult['verdict'];
  /** Sorted violated property ids. */
  violated: string[];
  /** Sorted checked property ids. */
  checked: string[];
  unmatched: number;
}

/** What a determinism or parity check compares. */
export function verdictSummary(r: { evaluation: EvalResult; unmatched: string[] }): VerdictSummary {
  return {
    verdict: r.evaluation.verdict,
    violated: r.evaluation.violations.map((v) => v.propertyId).sort(),
    checked: [...r.evaluation.checked].sort(),
    unmatched: r.unmatched.length,
  };
}
