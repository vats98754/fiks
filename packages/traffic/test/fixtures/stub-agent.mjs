// An `--agent-stub <module>` fixture: a default-export agent that makes one fixed call per session
// without contacting the server.
export default async function stub(input) {
  return {
    calls: [{ tool: 'get_item', args: { id: `x-${100 + input.trial}` }, toolError: null }],
    answer: 'module stub',
    outcome: 'ok',
    turns: 1,
    costUsd: 0,
    tokens: { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 },
    wallMs: 0,
  };
}
