# R9 contract log (blind contract, PLAN 5.10 step 2)

Bug: cloudflare/mcp-server-cloudflare #468, "List tools (zones_list, domain_list, worker_list)
return literal "[object Object]" instead of JSON" (open). Human fix candidate: PR #469 "fix:
return JSON from legacy list tools (#468)", one commit `7e576219a41e9b1e42187a852996bee29bded0cb`
whose only parent is the prefix `db9084730dd45ebb6ac4dd5d3181d189cc96e98d` (upstream `main`).
PR state on 2026-10-22: **closed, not merged** (`mergedAt: null`); the candidate row said
"open". The issue is still open, so there is no merged human fix: R9 is graded by held-out
manifestations only (WORKSTREAMS RB-R9 goal).

The contract was written from the symptom only. Inputs read before it was written: the issue
title and body (`gh issue view 468`), the candidate row in
`paper/research/real-bugs-mcp.candidates.json` (symptom, fault class, the invariant "text block
parses as JSON / matches outputSchema"), the R9 lines of `paper/research/real-bugs-mcp.md`
(one-line cluster entries only), PR #469 metadata only (`gh pr view 469 --json
number,title,state,headRefOid,baseRefName,createdAt,mergedAt,...` and `gh api .../pulls/469/commits`
for SHAs, parents and the first message line; no body, no files, no diff), the prefix commit's
metadata, the prefix tree listing, the root `package.json`, `server.json` and the `README.md`
lines that mention "legacy", and `git grep` for the tool names (which files register
`zones_list`/`workers_list` and which apps import them). Not read before the contract: the
implementation of any list tool (`packages/mcp-common/src/shared-tools/*.ts` bodies), the
prefix's response-formatting code, the fix PR body, its files and its diff.

## Session log (UTC, from `date -u` in the session)

| Time | Step |
|---|---|
| 2026-10-22T12:13:06Z | Read the R9 lines of `paper/research/real-bugs-mcp.md` (cluster F one-liner) and the candidate row. |
| 2026-10-22T12:13:10Z | Read issue #468 title + body (`gh issue view`). |
| 2026-10-22T12:13:12Z | PR #469 metadata only (title, state CLOSED, `mergedAt: null`, head `7e57621`, base `main`). |
| 2026-10-22T12:13:22Z | PR #469 commit list (one commit; parent = `db90847`) and prefix commit metadata via `gh api` (sha, parents, first message line, date). |
| 2026-10-22T12:13:33Z | Plain `git clone --no-checkout` of upstream into `.work/realbugs/R9`; fetched the PR head SHA by want (12:13:37Z). |
| 2026-10-22T12:13:41Z–12:14:06Z | Prefix tree listing, root `package.json`, `server.json`; `git grep` for the issue's tool names: the prefix registers `zones_list` (`packages/mcp-common/src/shared-tools/zone.tools.ts`) and `workers_list` (`.../worker.tools.ts`), used by the graphql, dns-analytics, workers-bindings, workers-builds and workers-observability apps; no `domain_list` or `worker_list`. The legacy stdio package the issue names (npm `@cloudflare/mcp-server-cloudflare` 0.2.0, `src/`) was deleted from the repo long before the prefix (commit `8896f0a`). |
| 2026-10-22T12:15:07Z | **Contract written**: `contract.json` sha256 `955448998b221a3cfba1eab254fbe7987270653e5b565d8132541848df8ddbf0`. |

Every later step (first read of the PR #469 diff, build, fixtures, harness) is logged below the
contract section, after this timestamp.

## The contract and why

Symptom (issue): calling `zones_list` (or `domain_list`, `worker_list`) with no arguments returns
the literal 15-character string `[object Object]` as the whole tool result, consistently, while
the same token against the REST API returns full JSON. Expected: "a JSON payload (e.g. an array
of zone objects), matching what the underlying Cloudflare REST API returns".

Properties (bug-specific kinds, evaluated by `harness/check.ts`; same `Violation`/`EvalResult`
shapes and `<contract id>/<property>` ids as `@fiks/contracts`):

- `<tool>/textJson` (the named property): on a non-error result, (a) no text content block
  contains `[object Object]`, and (b) when the result has any text block, at least one parses
  with `JSON.parse` to an object or an array.
- `<tool>/carriesUpstream`: every string `id` in the `result` array of the call's 2xx upstream
  JSON responses (Cloudflare v4 envelope) appears as a string value somewhere in the tool's
  payload (parsed text JSON or structuredContent). This is the "matching what the REST API
  returns" half of the expected behaviour; it stops a head that "fixes" the symptom by returning
  `{}` or `[]` from passing.
- `<tool>/outputSchema` (standard fiks property, via `@fiks/contracts` `evaluate`): when the
  tool declares an outputSchema in `tools/list`, structuredContent is present and matches it.

Choices made blind, before seeing the fix:

- Tools: `zones_list` and `workers_list`, the prefix's registered names for the issue's
  `zones_list` and `worker_list`. `domain_list` has no counterpart at the prefix and is not
  covered.
- (b) asks for *one* JSON text block, not that every text block is JSON: a server may add a
  human-readable note next to the JSON. A head that returns only prose (no JSON anywhere, no
  structuredContent) fails (b); that is intended, since the issue expects a JSON payload.
- The forbidden substring is checked in every text block, so a JSON block that embeds
  `"[object Object]"` as a value (coerced nested objects) also fails.
- An `isError` result is unverifiable, as in the fiks evaluator (an explicit error is seen).
- No range, count or freshness invariants: the symptom is about serialization only.

## Vocabulary gap (C11)

The frozen fiks vocabulary evaluates `structuredContent` only. A tool that returns only a text
block and declares no outputSchema is `unverifiable` under `@fiks/contracts` `evaluate` (no
structured data, no schema), so the issue's symptom (a text result that is not JSON) cannot be
expressed as a fiks invariant, and "matches the upstream" has only `equalsUpstream` on a single
structured path. Both properties are therefore bug-specific kinds (`textJson`,
`carriesUpstream`) in `harness/check.ts`. When the tool *does* declare an outputSchema, the
standard `outputSchema` property also applies and is evaluated by `@fiks/contracts` itself.
This is a real limit of the frozen vocabulary for this bug class (text-only results), recorded
for the paper's limitations, not a change to `@fiks/contracts`.
