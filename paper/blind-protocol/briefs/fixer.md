# Fixer brief

The MCP server in your working directory wraps a vendor HTTP API. The vendor changed the behaviour
of its responses (the published API description did not change); the change is described in
`blind/DRIFT.md`, and the response rewriter that reproduces it is `blind/drift/transform.ts`.
The tests in `test/hidden/` show the wrong results the server now returns.

Fix the server: edit files under `src/` only, so that every test in `test/hidden/` passes, the
existing tests stay green, and the server still works with the vendor's previous behaviour. Do
not edit tests. Bash runs offline in a container rooted at your working directory; use
`pnpm exec vitest run` and `pnpm typecheck`. You have no other source of information.
