# memory: create_entities silently drops observations for existing entities

<!-- upstream: https://github.com/modelcontextprotocol/servers/issues/4887 (opened 2026-09-28T17:58:53Z); title and body verbatim, for the ISSUE-TEXT arm -->

`create_entities` ignores entities whose name already exists. The README documents this, but the tool description the model sees does not ("Create multiple new entities in the knowledge graph"), and the response lists only the created entities. When an agent uses `create_entities` to record a new fact about an existing entity, the fact is dropped with no indication.

Reproduction (main f46d957, same in 2026.8.31):

1. `create_entities([{name: "Alice", entityType: "person", observations: ["Works at Acme"]}])`
2. `create_entities([{name: "Alice", entityType: "person", observations: ["Allergic to penicillin"]}])` returns `[]` and no error.
3. `open_nodes(["Alice"])` returns only `"Works at Acme"`.

This comes up often in practice:
- `search_nodes` matches the query as a single substring, so a query like `"Alice penicillin"` returns nothing and the model concludes Alice is not stored.
- The README's example prompt also tells the model to "Create entities for recurring organizations, people". #4519 measured the resulting confusion between `create_entities` and `add_observations`.

To see how much it matters, I ran agents against the server over MCP:
- The server's own tool list, and the README example prompt unchanged.
- 10 messages, each carrying a new fact about an entity already in memory.
- Three OpenAI models.

The fact was stored on the right entity in 69 of 130 runs. In 47 of the rest, the model had sent it through `create_entities` and it was silently dropped; the model usually told the user it had been saved.

Proposed fix, in a PR to follow: keep the documented behaviour and report which entities were skipped. With that change the same runs stored the fact in 116 of 130, with one silent drop.

Protocol (written before the runs), scenarios, harness and all recorded runs: https://github.com/yotambraun/agent-eval-flow/tree/f184978b4224aaff39e125fd0b25075e4af00532/examples/data/mcp-memory
