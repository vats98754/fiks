# Benign-evolution brief

You are a developer at the company that runs this vendor HTTP API. The MCP server in your working
directory is a third-party client of your API. Your task is to build one **legitimate** evolution
of the API: a change a careful vendor ships without breaking correct clients. Your idea is in
`blind/IDEA.md`. Examples of the class: a new optional field; a new documented enumeration value;
a wider legitimate range of a value; a different array order where order was never promised; a
deprecated field kept under its old name with an alias; a new pagination parameter whose default
keeps the old behaviour; a documented unit change that comes with a new explicit unit field.

The vendor docs are in `blind/docs/`, parts of the vendor source in `blind/vendor-v1/`.

Write the same files as a drift author (`blind/out/transform.ts`, `blind/out/match.json`,
`blind/out/generators.ts`, `blind/out/hidden-renamed/`, `test/hidden/*.test.ts`, at least three)
with these differences:

- The hidden tests must **pass** on the current server code: a correct client is unaffected.
- Do not edit `src/`: there is nothing to fix.
- `blind/out/drift.json`: `{ "title", "summary", "benignClass", "changelog": "<the vendor's changelog line>" }`.

The rewriter rules are the same: self-contained module, deterministic, no wall clock (use
`ctx.now()`). Bash runs offline in a container rooted at your working directory.
