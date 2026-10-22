// A deterministic stand-in for every traffic agent (`--agent-stub builtin`; tests; dry runs). It
// makes no LLM call: it connects to the real MCP server, and picks one or two tools and their
// arguments from a hash of (agent, task, trial) and the tools' input schemas. Same inputs, same calls.
import type { SessionCall, SessionOutput, TrafficAgent } from './agents.ts';
import { sha256 } from './canonical.ts';
import { connectMcp } from './mcp.ts';
import type { JsonSchema } from './schema.ts';

/** The first id-like token of the prompt (`p-1006`, `TRK-104`, `o-5001`), else its first long word. */
function token(prompt: string, i: number): string {
  const ids = prompt.match(/\b[A-Za-z]{1,4}-\d{3,5}\b/g) ?? [];
  if (ids.length) return ids[i % ids.length] as string;
  const words = (prompt.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => w !== 'what' && w !== 'which');
  return words[i % Math.max(words.length, 1)] ?? 'item';
}

/** Arguments for `schema` from the prompt; required members always, optional ones never. */
export function synthArgs(schema: JsonSchema | undefined, prompt: string, i = 0): unknown {
  const s = schema ?? {};
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if ('const' in s) return s.const;
  for (const key of ['anyOf', 'oneOf'] as const) {
    const b = s[key];
    if (Array.isArray(b) && b.length) return synthArgs(b[0] as JsonSchema, prompt, i);
  }
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  switch (t) {
    case 'string':
      return token(prompt, i);
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? Math.max(1, s.minimum) : 1;
    case 'boolean':
      return false;
    case 'array': {
      const n = typeof s.minItems === 'number' ? Math.max(1, s.minItems) : 1;
      return Array.from({ length: n }, (_, k) => synthArgs(s.items as JsonSchema, prompt, i + k));
    }
    default: {
      const props = (s.properties ?? {}) as Record<string, JsonSchema>;
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(props).sort()) if (required.has(k)) out[k] = synthArgs(props[k], prompt, i);
      return out;
    }
  }
}

/** The built-in stub agent. */
export function stubAgent(): TrafficAgent {
  return async (input) => {
    const t0 = Date.now();
    const h = sha256(`${input.agent}\n${input.taskId}\n${input.trial}`);
    const client = await connectMcp(input.server, 'fiks-traffic-stub');
    const calls: SessionCall[] = [];
    try {
      const tools = (await client.listTools()).tools
        .map((t) => ({ name: t.name, inputSchema: t.inputSchema as JsonSchema }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const n = 1 + (Number.parseInt(h.slice(0, 2), 16) % 2);
      for (let i = 0; i < n && tools.length; i++) {
        const tool = tools[Number.parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16) % tools.length];
        if (!tool) continue;
        const args = synthArgs(tool.inputSchema, input.prompt, i) as Record<string, unknown>;
        const r = await client.callTool({ name: tool.name, arguments: args });
        calls.push({ tool: tool.name, args, toolError: r.isError === true });
      }
    } finally {
      await client.close().catch(() => {});
    }
    const out: SessionOutput = {
      calls,
      answer: 'stub',
      outcome: 'ok',
      turns: calls.length + 1,
      costUsd: 0,
      tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
      wallMs: Date.now() - t0,
    };
    return out;
  };
}
