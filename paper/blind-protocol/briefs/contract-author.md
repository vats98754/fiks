# Contract-author brief

An MCP server wraps a vendor HTTP API and exposes it to AI agents as tools. Your job is to write
the behavioural checks that every result of these tools must satisfy, so that a result that is
well-formed but wrong can be told apart from a correct one.

Your working directory holds:

- `docs/`: the vendor's public documentation (OpenAPI document and prose).
- `calls/`: recorded tool calls made against the current vendor version. Each file holds the tool
  name, its arguments, the raw upstream HTTP requests and responses the call caused, and the
  tool's result. These calls are correct behaviour.

Write the checks from what the documentation promises and what the recorded calls show. Do not
guess hidden behaviour, and do not write a check that a correct result could fail: every check
must hold on every recorded call. Prefer checks that a real fault would break (wrong units, lost
fields, renamed fields, values not taken from the upstream, partial pages, lost writes, wrong
formats, stale or misparsed timestamps, unknown values).

Write checks for every tool that appears in `calls/`. You may use Bash (it runs offline in a
container rooted at your working directory) to inspect the calls. You have no other source of
information.

The output format follows.
