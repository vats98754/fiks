# Drift-author brief (realistic)

You are a developer at the company that runs this vendor HTTP API. The MCP server in your working
directory (`src/`, `test/`, `package.json`, ...) is a third-party client of your API; you cannot
change it in production. Your task is to build one realistic upstream change ("drift") that this
server handles wrongly **without any error**: the server keeps answering, but some answers are
wrong. Then you write the tests that prove the server is wrong under the change, and a fix.

Your idea is in `blind/IDEA.md`. The vendor's public docs are in `blind/docs/`; parts of the
vendor's current source are in `blind/vendor-v1/`; a taxonomy of real faults is in
`blind/TAXONOMY.md`.

Rules for the change:

- The vendor's published API description does not change (the OpenAPI document and the docs stay
  exactly as they are). Only the behaviour of the responses changes.
- The change is applied by a response rewriter in front of the vendor. Write it as
  `blind/out/transform.ts`: a self-contained TypeScript module (no imports except `import type`)
  whose default export is
  `{ description: string, setHeaders?: Record<string, string>, response(req, res, ctx) }`.
  `req` is `{ method, path, query: URLSearchParams, headers, body }`, `res` is
  `{ status, headers, body }` (body is the UTF-8 text) and `ctx` is `{ now(): Date, state: Map }`.
  `response` returns the rewritten `res`, or `undefined` to pass it through. It must be
  deterministic: no randomness and no wall clock (use `ctx.now()`).
- `blind/out/match.json`: `{ "method": "GET" | "POST" | "GET|POST" | "*", "pathPattern": "<regex on the path>" }`,
  the requests the rewriter applies to.

Tests and fix:

- Hidden tests in `test/hidden/*.test.ts`: at least three files, each a different manifestation
  (another input to the same tool, another tool that reads the changed data, and one that shows
  the unchanged behaviour still works). Each test is self-contained: it starts a local HTTP
  server that answers with the changed upstream responses (written out in the test), points the
  server's vendor client at it, calls the tool handler, and asserts the correct result (what the
  tool should return given the vendor's data). They must fail on the current server code and pass
  with your fix.
- `blind/out/hidden-renamed/`: the same test files with every entity identifier replaced by a new
  identifier that appears nowhere else.
- The fix: edit files under `src/` only, so that every hidden test passes and the existing tests
  stay green.
- `blind/out/generators.ts`: a self-contained module whose default export is
  `(random: () => number) => { tool: string; args: Record<string, unknown> }[]`: inputs that
  exercise the changed behaviour.
- `blind/out/drift.json`:
  `{ "title", "summary", "category" (taxonomy category), "symptom" (taxonomy class), "plausibleString": boolean, "changelog": "<one line a vendor could publish, or null>" }`.

Bash runs offline in a container rooted at your working directory; use
`pnpm exec vitest run test/hidden` and `pnpm typecheck` to check your work. You have no other
source of information and no network.
