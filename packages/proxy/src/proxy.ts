import {
  buildProbeArgs,
  type ContractFile,
  evaluate,
  findContract,
  type HttpExchange,
  type JsonSchema,
  type ToolResultLike,
} from '@fiks/contracts';
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
import { makeReceipt, RECEIPT_META_KEY, type Receipt, receiptText } from './receipt.ts';
import { startTap, type Tap } from './tap.ts';

export type UpstreamConfig =
  | { transport: 'stdio'; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
  | { transport: 'http'; url: string }
  /** Any MCP transport, e.g. in-memory for tests. */
  | { transport: 'custom'; create: () => Transport };

export interface CallRecord {
  tool: string;
  args: Record<string, unknown>;
  /** The upstream result exactly as received. */
  result: ToolResultLike;
  receipt: Receipt;
  http: HttpExchange[];
  probe?: { tool: string; args: Record<string, unknown>; result: ToolResultLike; http: HttpExchange[] };
  at: string;
}

export interface ProxyOptions {
  upstream: UpstreamConfig;
  contracts: ContractFile;
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

export async function startProxy(opts: ProxyOptions): Promise<FiksProxy> {
  validateContracts(opts.contracts);
  const receiptField = opts.receiptField === undefined ? DEFAULT_RECEIPT_FIELD : opts.receiptField;
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
  const schemas = new Map<string, JsonSchema | undefined>();
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
    const { tools } = await listUpstream();
    for (const t of tools) schemas.set(t.name, t.outputSchema as JsonSchema | undefined);
    return tools;
  }

  async function handleCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return lock(async () => {
      if (!schemas.has(name)) await refreshTools();
      tap?.take();
      const result = await callUpstream(name, args);
      const http = tap?.take() ?? [];
      const contract = findContract(opts.contracts, name);

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

      const at = now();
      // Without a tap the upstream is unknown: upstream-based checks are skipped, not failed.
      const evaluation = evaluate(contract, {
        args,
        result,
        now: at,
        declaredOutputSchema: schemas.get(name),
        probe: probe && { ...probe, upstream: tap ? probe.http : undefined },
        upstream: tap ? http : undefined,
      });
      const observed = Boolean(tap);
      let receipt = makeReceipt(evaluation, at, observed);
      const record: CallRecord = { tool: name, args, result, receipt, http, probe, at: at.toISOString() };
      try {
        const extra = await opts.onCall?.(record);
        if (extra?.traceId) receipt = makeReceipt(evaluation, at, observed, extra.traceId);
      } catch (e) {
        // Recording problems (e.g. a full disk) must not break the agent's call.
        console.error(`[fiks-proxy] onCall failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      record.receipt = receipt;

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
      for (const t of res.tools) schemas.set(t.name, t.outputSchema as JsonSchema | undefined);
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
