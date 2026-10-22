// Stub contract author (tests only): reads the export it was given (calls/ or tools/tools.json),
// writes a small schema-valid contract file to out/contracts.json, and sends one Read and one Bash
// call through the session's permission hook (the Bash runs in the `--network none` container and
// tries a DNS lookup, which the sandbox must deny).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StubAuthor } from '../../src/stub.ts';

const author: StubAuthor = (req) => {
  if (req.route !== 'session') return { text: '{}' };
  const server = /The server is `([^`]+)`/.exec(req.prompt)?.[1] ?? 'unknown';
  const domain = server.replace(/-mcp$/, '');
  const firstOutput = new Map<string, Record<string, unknown> | undefined>();
  let firstCall = '';
  for (const f of readdirSync(join(req.cwd, 'calls')).sort()) {
    firstCall ||= `calls/${f}`;
    const c = JSON.parse(readFileSync(join(req.cwd, 'calls', f), 'utf8')) as {
      tool: string;
      result: { structuredContent?: Record<string, unknown>; isError?: boolean };
    };
    const ok = c.result.structuredContent && !c.result.isError ? c.result.structuredContent : undefined;
    if (!firstOutput.get(c.tool)) firstOutput.set(c.tool, ok);
  }
  const contracts = [...firstOutput.entries()].map(([tool, out]) => {
    const key = out ? Object.keys(out).sort()[0] : undefined;
    return {
      id: `${domain}.${tool}`,
      tool,
      invariants: key ? [{ id: `${key}.notNull`, kind: 'notNull', path: key }] : [],
    };
  });
  return {
    toolUses: [
      { name: 'Read', input: { file_path: join(req.cwd, firstCall) } },
      {
        name: 'Bash',
        input: {
          command:
            "ls calls | wc -l; node -e \"require('dns').lookup('example.com',(e)=>console.log(e?'EGRESS_DENIED '+e.code:'EGRESS_OK'))\"",
        },
      },
    ],
    files: {
      'out/contracts.json': `${JSON.stringify({ server, version: 1, contracts }, null, 2)}\n`,
      'out/NOTES.md': contracts.map((c) => `- ${c.id}: ${c.invariants[0]?.id ?? 'schema only'}`).join('\n'),
    },
    text: 'wrote out/contracts.json',
  };
};

export default author;
