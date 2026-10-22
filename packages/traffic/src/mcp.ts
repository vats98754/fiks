// The domain's MCP server as a stdio spec, and a plain MCP client for listing its tools (no LLM:
// works under FIKS_LLM_FORBID=1, so stub runs and tests need no model).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { JsonSchema } from './schema.ts';

/** One stdio MCP server process: `Domain.serverCommand(dir)` plus its env. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Working directory (Domain.serverCommand gives one; its args may be relative to it). */
  cwd?: string;
}

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/**
 * The spec in the Agent SDK's stdio form, which has no `cwd`: the server is started through
 * `/bin/sh -c 'cd "$0" && exec "$@"' <cwd> <command> <args...>`, so relative args keep working.
 */
export function sdkStdio(spec: McpServerSpec): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  if (!spec.cwd) return { command: spec.command, args: [...spec.args], env: { ...spec.env } };
  return {
    command: '/bin/sh',
    args: ['-c', 'cd "$0" && exec "$@"', spec.cwd, spec.command, ...spec.args],
    env: { ...spec.env },
  };
}

/** A connected MCP client over stdio. */
export async function connectMcp(spec: McpServerSpec, name = 'fiks-traffic'): Promise<Client> {
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: spec.env,
      ...(spec.cwd ? { cwd: spec.cwd } : {}),
      stderr: 'ignore',
    }),
  );
  return client;
}

/** The server's tools, sorted by name. */
export async function listServerTools(spec: McpServerSpec): Promise<ToolDef[]> {
  const client = await connectMcp(spec);
  try {
    const { tools } = await client.listTools();
    return tools
      .map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema as JsonSchema,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } finally {
    await client.close().catch(() => {});
  }
}
