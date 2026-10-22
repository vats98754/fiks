// Spawns an unmodified MCP server process and talks to it over stdio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  type CallToolResult,
  CallToolResultSchema,
  ListToolsResultSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface ServerCommand {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface SpawnOptions {
  /**
   * Also pass this process's whole environment (default false: only the SDK's default variables,
   * e.g. PATH and HOME, plus `env`), so a server under test never sees host secrets.
   */
  inheritEnv?: boolean;
  /** Per-request timeout for initialize, tools/list and tools/call (default 60 s). */
  timeoutMs?: number;
  clientName?: string;
}

export interface McpStdioServer {
  client: Client;
  /** The child's pid, once started. */
  pid: number | null;
  listTools(): Promise<Tool[]>;
  /**
   * A raw tools/call: the result is passed through as the server sent it, not validated against
   * the declared outputSchema (the SDK client would turn a non-conforming result into an error).
   */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  /** Everything the server wrote to stderr so far. */
  stderr(): string;
  close(): Promise<void>;
}

/** `["node", "dist/index.js"]` or `{command, args, cwd}`. */
export function toServerCommand(cmd: ServerCommand | string[], cwd?: string): ServerCommand {
  if (!Array.isArray(cmd)) return cmd;
  const [command, ...args] = cmd;
  if (!command) throw new Error('empty server command');
  return { command, args, cwd };
}

export async function spawnServer(
  cmd: ServerCommand | string[],
  env: Record<string, string> = {},
  opts: SpawnOptions = {},
): Promise<McpStdioServer> {
  const spec = toServerCommand(cmd);
  const inherited = opts.inheritEnv
    ? Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    : {};
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    cwd: spec.cwd,
    env: { ...getDefaultEnvironment(), ...inherited, ...env },
    stderr: 'pipe',
  });
  let err = '';
  transport.stderr?.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });
  const client = new Client({ name: opts.clientName ?? 'fiks-replay-proc', version: '0.1.0' });
  const timeout = opts.timeoutMs ?? 60_000;
  try {
    await client.connect(transport, { timeout });
  } catch (e) {
    await transport.close().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `MCP server ${spec.command} ${(spec.args ?? []).join(' ')} did not start: ${msg}\n${err}`,
    );
  }
  return {
    client,
    pid: transport.pid,
    listTools: async () =>
      (await client.request({ method: 'tools/list' }, ListToolsResultSchema, { timeout })).tools,
    callTool: (name, args) =>
      client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, {
        timeout,
      }) as Promise<CallToolResult>,
    stderr: () => err,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}
