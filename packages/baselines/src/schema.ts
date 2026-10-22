// B-SCHEMA (PLAN 6.1): the pinned MCP SDK client's own outputSchema validation, run on the recorded
// result. A real SDK Client calls the tool on an in-memory server that answers tools/list with the
// recorded tool definition and tools/call with the recorded output, so the verdict is whatever
// `Client.callTool` (@modelcontextprotocol/sdk 1.32.0) accepts or rejects. No fiks code decides it.

import type { MonitorInput, MonitorResult, MonitorToolDef } from '@fiks/interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { BaselineMonitor } from './types.ts';
import { canonicalJson } from './util.ts';

export const B_SCHEMA_ID = 'B-SCHEMA';
export const B_SCHEMA_PROPERTY = 'B-SCHEMA/outputSchema';

interface Harness {
  client: Client;
  next: { result: Record<string, unknown> | null };
  /** Serialises calls: the queued result is shared state. */
  tail: Promise<unknown>;
  close(): Promise<void>;
}

async function openHarness(toolDef: MonitorToolDef): Promise<Harness> {
  const next: Harness['next'] = { result: null };
  const server = new Server(
    { name: 'fiks-b-schema-replay', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  const tool = { ...toolDef, inputSchema: toolDef.inputSchema ?? { type: 'object' } };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    if (!next.result) throw new Error('no recorded result queued');
    return next.result;
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'fiks-b-schema', version: '0.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  await client.listTools(); // caches the SDK's output validator for this tool
  return {
    client,
    next,
    tail: Promise.resolve(),
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/**
 * B-SCHEMA monitor. `unverifiable` when the tool declares no outputSchema (the SDK validates
 * nothing then); otherwise `violated` iff `Client.callTool` throws on the recorded result.
 */
export function createSchemaMonitor(): BaselineMonitor & { close(): Promise<void> } {
  const harnesses = new Map<string, Promise<Harness>>();
  const monitor = async (input: MonitorInput): Promise<MonitorResult> => {
    const toolDef = input.toolDef;
    if (!toolDef?.outputSchema) return { verdict: 'unverifiable', checked: [], violations: [], disabled: [] };
    const def = { ...toolDef, name: input.tool };
    const key = canonicalJson(def);
    let h = harnesses.get(key);
    if (!h) {
      h = openHarness(def);
      harnesses.set(key, h);
    }
    const harness = await h;
    const run = harness.tail.then(() => validateOne(harness, input));
    harness.tail = run.catch(() => undefined);
    return run;
  };
  return Object.assign(monitor, {
    id: B_SCHEMA_ID,
    async close() {
      const all = [...harnesses.values()];
      harnesses.clear();
      await Promise.all(all.map(async (h) => (await h).close()));
    },
  });
}

async function validateOne(harness: Harness, input: MonitorInput): Promise<MonitorResult> {
  // The recorded output, exactly as the server returned it (content defaults to [] as on the wire).
  harness.next.result = { content: [], ...(input.result as Record<string, unknown>) };
  const checked = [B_SCHEMA_PROPERTY];
  try {
    await harness.client.callTool({
      name: input.tool,
      arguments: (input.args ?? {}) as Record<string, unknown>,
    });
    return { verdict: 'verified', checked, violations: [], disabled: [] };
  } catch (err) {
    if (!(err instanceof McpError)) throw err;
    return {
      verdict: 'violated',
      checked,
      violations: [
        {
          propertyId: B_SCHEMA_PROPERTY,
          kind: 'outputSchema',
          path: '$',
          expected: 'declared outputSchema (MCP SDK client validation)',
          actual: null,
          message: err.message,
        },
      ],
      disabled: [],
    };
  } finally {
    harness.next.result = null;
  }
}
