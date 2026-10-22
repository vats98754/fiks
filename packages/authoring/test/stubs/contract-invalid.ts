// Stub contract author whose output fails validation (unknown check kind): nothing may be written.
import type { StubAuthor } from '../../src/stub.ts';

const author: StubAuthor = (req) => {
  if (req.route !== 'session') return { text: '{}' };
  const server = /The server is `([^`]+)`/.exec(req.prompt)?.[1] ?? 'unknown';
  return {
    files: {
      'out/contracts.json': JSON.stringify({
        server,
        version: 1,
        contracts: [
          { id: 'x.get', tool: 'get_issue', invariants: [{ id: 'p', kind: 'telepathy', path: 'key' }] },
        ],
      }),
    },
  };
};

export default author;
