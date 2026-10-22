import {
  buildProbeArgs,
  type ContractFile,
  findContract,
  type HttpExchange,
  type JsonSchema,
  type ToolResultLike,
} from '@fiks/contracts';
import type { Monitor, MonitorResult, MonitorToolDef } from '@fiks/interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ResultSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { receiptHints } from './hints.ts';
import { asEvalResult, CONTRACTS_MONITOR_ID, contractsMonitor, monitorId, NO_MONITOR } from './monitor.ts';
import { makeReceipt, RECEIPT_META_KEY, type Receipt, receiptText } from './receipt.ts';
import { startTap, type Tap } from './tap.ts';

export type UpstreamConfig =
  | { transport: 'stdio'; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  | { transport: 'http'; url: string }
  /** Any MCP transport, e.g. in-memory for tests. */
  | { transport: 'custom'; create: () => Transport };

/** One proxied tool call as recorded, whether or not a monitor evaluated it. */
export interface RecordedCall {
  tool: string;
  args: Record<string, unknown>;
  /** The upstream result exactly as received. */
  result: ToolResultLike;
  /** The monitor's verdict on the call; absent under `--monitor none`. */
  receipt?: Receipt;
  http: HttpExchange[];
  probe?: { tool: string; args: Record<string, unknown>; result: ToolResultLike; http: HttpExchange[] };
  /**
   * The evaluation instant: the `now()` passed to the monitor (under `--monitor none`, the
   * instant that would have been used). Offline replay evaluates with exactly this `now`
   * (`CallRecord.capturedAt` in the paper's record format).
   */
  at: string;
  /** Monitor id (`contracts`, `none` or the module's id). */
  monitor: string;
  /** Wall time the monitor took, in milliseconds (0 under `--monitor none`). */
  monitorMs: number;
  /** False when no tap saw the upstream HTTP (upstream-based checks are skipped). */
  upstreamObserved: boolean;
  /** The tool as the upstream declared it in tools/list (its outputSchema is checked). */
  toolDef?: MonitorToolDef;
  /** Log-only mode: the agent got the upstream result untouched. */
  logOnly?: true;
  /** Set when a module monitor threw; the receipt is then `unverifiable`. */
  monitorError?: string;
  costUsd?: number;
  tokens?: number;
}

/** A call a monitor evaluated (every call unless `--monitor none`). */
export interface CallRecord extends RecordedCall {
  receipt: Receipt;
}

export interface ProxyOptions {
  upstream: UpstreamConfig;
  /** Required unless `monitor` is `'none'` (then it is never read). */
  contracts?: ContractFile;
  /**
   * Checks every result (default: the contract evaluator). `'none'` records calls with no
   * evaluation, no read-back probe and no receipt.
   */
  monitor?: Monitor | typeof NO_MONITOR;
  /** Evaluate and record, but return every upstream result (and tools/list) untouched. */
  logOnly?: boolean;
  /** stdio upstream only: put a recording tap in front of the URL in this env var. */
  tapEnvVar?: string;
  /** A tap the caller owns (e.g. when the upstream is a separate HTTP process). */
  tap?: Tap;
  now?: () => Date;
  /**
   * Called for every tools/call before the result goes back to the agent. Return a traceId
   * (after persisting a trace) to have it named in the receipt.
   */
  onCall?: (rec: CallRecord) => Promise<{ traceId?: string } | undefined> | { traceId?: string } | undefined;
  /** Called for every tools/call (also under `--monitor none`), after `onCall`, with the final record. */
  onRecord?: (rec: RecordedCall) => Promise<void> | void;
  /**
   * Name of the field fiks adds to `structuredContent` with the receipt text (default
   * `fiks_receipt`; `null` to disable). Clients such as Claude Code show the model only
   * structuredContent when a tool returns it, so a text block alone never reaches the agent.
   */
  receiptField?: string | null;
}

export interface FiksProxy {
  upstream: Client;
  tap?: Tap;
  /** A downstream MCP server bound to this proxy; one per downstream connection. */
  createServer(): Server;
  connect(downstream: Transport): Promise<Server>;
  close(): Promise<void>;
}

/** Serializes async work so every upstream HTTP exchange belongs to exactly one call. */
function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** One read-after-write postcondition per contract: the proxy runs exactly one probe. */
export function validateContracts(file: ContractFile): void {
  for (const c of file.contracts) {
    if ((c.postconditions?.length ?? 0) > 1) {
      throw new Error(`contract ${c.id}: at most one postcondition is supported`);
    }
  }
}

const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

/** Recording problems (e.g. a full disk) must not break the agent's call. */
async function safely(what: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[fiks-proxy] ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const DEFAULT_RECEIPT_FIELD = 'fiks_receipt';

/** The declared outputSchema plus fiks's optional receipt field, so clients that validate accept it. */
export function withReceiptField(schema: unknown, field: string): unknown {
  const s = schema as { type?: unknown; properties?: Record<string, unknown> } | undefined;
  if (s?.type !== 'object') return schema;
  return {
    ...s,
    properties: {
      ...(s.properties ?? {}),
      [field]: {
        type: 'string',
        description: 'Added by fiks-proxy: a check of this result against its contract.',
      },
    },
  };
}

/** A tools/list entry as monitors see it. */
function toolDefOf(t: Tool): MonitorToolDef {
  return {
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    inputSchema: t.inputSchema as JsonSchema,
    ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema as JsonSchema } : {}),
  };
}

const NO_CONTRACTS: ContractFile = { server: '', version: 1, contracts: [] };

export async function startProxy(opts: ProxyOptions): Promise<FiksProxy> {
  const monitor = opts.monitor ?? contractsMonitor();
  const unmonitored = monitor === NO_MONITOR;
  if (!opts.contracts && !unmonitored && monitorId(monitor, '') === CONTRACTS_MONITOR_ID) {
    throw new Error('the contracts monitor needs contracts');
  }
  const contracts = unmonitored ? NO_CONTRACTS : (opts.contracts ?? NO_CONTRACTS);
  validateContracts(contracts);
  const id = unmonitored ? NO_MONITOR : monitorId(monitor, 'custom');
  // Log-only and unmonitored proxies return upstream results (and tools/list) untouched.
  const decorate = !opts.logOnly && !unmonitored;
  const receiptField = !decorate
    ? null
    : opts.receiptField === undefined
      ? DEFAULT_RECEIPT_FIELD
      : opts.receiptField;
  const now = opts.now ?? (() => new Date());
  let tap = opts.tap;
  let ownTap: Tap | undefined;

  let transport: Transport;
  if (opts.upstream.transport === 'stdio') {
    // The upstream inherits the agent's environment (servers are configured through it).
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    );
    const env = { ...getDefaultEnvironment(), ...inherited, ...(opts.upstream.env ?? {}) };
    if (opts.tapEnvVar) {
      const target = env[opts.tapEnvVar] ?? process.env[opts.tapEnvVar];
      if (!target) throw new Error(`--tap ${opts.tapEnvVar}: the variable is not set`);
      ownTap = await startTap(target);
      tap = ownTap;
      env[opts.tapEnvVar] = ownTap.url;
    }
    transport = new StdioClientTransport({
      command: opts.upstream.command,
      args: opts.upstream.args ?? [],
      cwd: opts.upstream.cwd,
      env,
      stderr: 'pipe',
    });
  } else if (opts.upstream.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(opts.upstream.url));
  } else {
    transport = opts.upstream.create();
  }

  const upstream = new Client({ name: 'fiks-proxy', version: '0.1.0' });
  await upstream.connect(transport);
  const info = upstream.getServerVersion() ?? { name: 'upstream', version: '0' };
  const capabilities = upstream.getServerCapabilities() ?? {};
  const tools = new Map<string, Tool>();
  const lock = mutex();

  // Raw requests, not client.callTool/listTools: the SDK client validates results against
  // the declared outputSchema and would turn a non-conforming upstream result into an error.
  // fiks must pass the upstream result through and report the mismatch in its receipt.
  const callUpstream = (name: string, args: Record<string, unknown>) =>
    upstream.request(
      { method: 'tools/call', params: { name, arguments: args } },
      CallToolResultSchema,
    ) as Promise<CallToolResult>;
  const listUpstream = (params?: Record<string, unknown>) =>
    upstream.request({ method: 'tools/list', params }, ListToolsResultSchema);

  async function refreshTools(): Promise<Tool[]> {
    const { tools: listed } = await listUpstream();
    for (const t of listed) tools.set(t.name, t);
    return listed;
  }

  async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return lock(async () => {
      if (!tools.has(name)) await refreshTools();
      tap?.take();
      const result = await callUpstream(name, args);
      const http = tap?.take() ?? [];
      // Under --monitor none no contract is consulted, so no read-back probe runs either.
      const contract = unmonitored ? undefined : findContract(contracts, name);
      const def = tools.get(name);
      const toolDef = def ? toolDefOf(def) : undefined;

      let probe: CallRecord['probe'];
      const post = contract?.postconditions?.[0];
      if (post && !result.isError && result.structuredContent) {
        const probeArgs = buildProbeArgs(post, result.structuredContent);
        // A failing probe must never replace the write's own result (the write happened).
        let probeResult: CallToolResult;
        try {
          probeResult = await callUpstream(post.probeTool, probeArgs);
        } catch (e) {
          probeResult = errorResult(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        probe = { tool: post.probeTool, args: probeArgs, result: probeResult, http: tap?.take() ?? [] };
      }

      // The evaluation instant; recorded as `at` even when no monitor runs.
      const at = now();
      const observed = Boolean(tap);
      const facts = {
        at: at.toISOString(),
        monitor: id,
        monitorMs: 0,
        upstreamObserved: observed,
        ...(toolDef ? { toolDef } : {}),
        ...(opts.logOnly ? { logOnly: true as const } : {}),
      };

      if (monitor === NO_MONITOR) {
        const record: RecordedCall = { tool: name, args, result, http, ...facts };
        await safely('onRecord', () => opts.onRecord?.(record));
        return result;
      }

      // Without a tap the upstream is unknown: upstream-based checks are skipped, not failed.
      const started = performance.now();
      let outcome: MonitorResult;
      let monitorError: string | undefined;
      try {
        outcome = await monitor({
          args,
          result,
          now: at,
          declaredOutputSchema: toolDef?.outputSchema,
          probe: probe && { ...probe, upstream: tap ? probe.http : undefined },
          upstream: tap ? http : undefined,
          tool: name,
          contract: contract ?? null,
          toolDef: toolDef ?? null,
        });
      } catch (e) {
        monitorError = e instanceof Error ? e.message : String(e);
        console.error(`[fiks-proxy] monitor ${id} failed: ${monitorError}`);
        outcome = { verdict: 'unverifiable', checked: [], violations: [], disabled: [] };
      }
      const monitorMs = Math.round((performance.now() - started) * 1000) / 1000;
      const evaluation = asEvalResult(outcome, contract);
      const hints = receiptHints({
        contract,
        evaluation,
        structured: result.structuredContent as Record<string, unknown> | undefined,
        upstream: tap ? http : undefined,
        probeUpstream: tap ? probe?.http : undefined,
      });
      let receipt = makeReceipt(evaluation, at, observed, undefined, hints);
      const record: CallRecord = {
        tool: name,
        args,
        result,
        receipt,
        http,
        probe,
        ...facts,
        monitorMs,
        ...(monitorError !== undefined ? { monitorError } : {}),
        ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
        ...(outcome.tokens !== undefined ? { tokens: outcome.tokens } : {}),
      };
      await safely('onCall', async () => {
        const extra = await opts.onCall?.(record);
        if (extra?.traceId) receipt = makeReceipt(evaluation, at, observed, extra.traceId, hints);
      });
      record.receipt = receipt;
      await safely('onRecord', () => opts.onRecord?.(record));
      if (opts.logOnly) return result;

      const reason = !contract
        ? 'no contract for this tool'
        : result.isError
          ? 'the tool returned an error'
          : !result.structuredContent
            ? 'no structured result to check'
            : undefined;
      // Upstream fields are passed through unchanged. fiks only adds: its receipt in _meta, one
      // trailing text block, and (when there is structured output) one receipt field in it.
      const text = receiptText(receipt, name, reason);
      const structured =
        // Never overwrite an upstream field that happens to have the same name.
        result.structuredContent && receiptField && !(receiptField in result.structuredContent)
          ? { structuredContent: { ...result.structuredContent, [receiptField]: text } }
          : {};
      return {
        ...result,
        ...structured,
        content: [...(result.content ?? []), { type: 'text', text }],
        _meta: { ...(result._meta ?? {}), [RECEIPT_META_KEY]: receipt },
      };
    });
  }

  function createServer(): Server {
    const server = new Server(info, { capabilities, instructions: upstream.getInstructions() });
    server.setRequestHandler(ListToolsRequestSchema, async (req) => {
      const res = await listUpstream(req.params);
      for (const t of res.tools) tools.set(t.name, t);
      if (!receiptField) return res;
      return {
        ...res,
        tools: res.tools.map((t) =>
          t.outputSchema
            ? { ...t, outputSchema: withReceiptField(t.outputSchema, receiptField) as Tool['outputSchema'] }
            : t,
        ),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, (req) =>
      handleCall(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>),
    );
    // Everything else (resources, prompts, completion, ping) is forwarded unchanged.
    server.fallbackRequestHandler = async (req) =>
      upstream.request({ method: req.method, params: req.params }, ResultSchema);
    return server;
  }

  return {
    upstream,
    tap,
    createServer,
    async connect(downstream) {
      const server = createServer();
      await server.connect(downstream);
      return server;
    },
    async close() {
      await upstream.close();
      await ownTap?.close();
    },
  };
}
