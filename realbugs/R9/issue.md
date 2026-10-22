# List tools (zones_list, domain_list, worker_list) return literal "[object Object]" instead of JSON

<!-- Upstream issue https://github.com/cloudflare/mcp-server-cloudflare/issues/468 (opened 2026-09-01T14:00:18Z), title and body verbatim, for the ISSUE-TEXT arm. -->

## Description

Several list-type tools return the literal string `[object Object]` as their entire tool result, instead of the expected JSON array/object. This happens consistently, not intermittently.

## Affected tools (confirmed)

- `zones_list`
- `domain_list`
- `worker_list`

## Environment

- Package: `@cloudflare/mcp-server-cloudflare`
- Version: `0.2.0` (latest on npm at time of report)
- Invocation: `npx -y @cloudflare/mcp-server-cloudflare run <account-id>`
- Client: Claude Code (MCP client), stdio transport
- Auth: `CLOUDFLARE_API_TOKEN` set via env

## Steps to reproduce

1. Configure the server as an MCP stdio server with a valid `CLOUDFLARE_API_TOKEN` (confirmed valid — same token works fine against the REST/GraphQL APIs directly via `curl`).
2. Call `zones_list` (or `domain_list`, or `worker_list`) with no arguments.
3. Observe the tool result is the literal 15-character string `[object Object]` rather than JSON.

## Expected behavior

The tool should return a JSON payload (e.g. an array of zone objects), matching what the underlying Cloudflare REST API returns.

## Actual behavior

The tool result is the literal string `[object Object]`, which strongly suggests the handler is calling `String(obj)` / relying on implicit `.toString()` coercion on a response object somewhere, instead of `JSON.stringify(obj)`, before returning the result over the MCP transport.

## Additional notes

- Reproduced across multiple separate connection attempts, including a full server/session restart — this rules out a stale-connection or transient-state explanation.
- Verified the API token itself is valid and has the needed permissions (`#zone:read`, `#dns_records:read`, `#analytics:read`, etc.) by calling the Cloudflare REST and GraphQL Analytics APIs directly with the same token — those work correctly and return full JSON.
- Confirmed on the current latest published version (`0.2.0`), not an outdated cached build.

Happy to provide more detail if useful.
