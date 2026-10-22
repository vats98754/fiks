# R10 contract log (blind contract, PLAN 5.10 step 2)

Bug: modelcontextprotocol/servers #4887, "memory: create_entities silently drops observations
for existing entities". Human fix: PR #5008 (merge `1520a8bbf82ee6b5ea29095db49772d8a098c1ab`,
first parent = prefix `272d7f62aa5166685ca1af6ba124b63ce6853ad5`, base branch `v2/main`).

The contract was written from the symptom only. Inputs read before it was written: the issue
title and body (`gh issue view 4887`), the candidate row in
`paper/research/real-bugs-mcp.candidates.json` (symptom, fault class, fix PR title), the PR's
metadata only (`gh pr view 5008 --json mergeCommit,state,mergedAt,baseRefName,title,number`; no
body, no files, no diff), the prefix commit's tree listing, `src/memory/package.json` and
`src/memory/README.md` at the prefix, and the prefix server's own `tools/list` (names,
descriptions, input and output schemas). Not read before the contract: the prefix
implementation of `create_entities` (`src/memory/index.ts`), the fix PR body, its commits, its
files and its diff.

## Session log (UTC, from `date -u` in the session)

| Time | Step |
|---|---|
| 2026-10-22T11:44:47Z | Read issue #4887 title + body (`gh issue view`). |
| 2026-10-22T11:45:16Z | PR #5008 metadata only (merge commit, base branch, title); merge commit parents via `gh api .../commits/1520a8b` (sha, parents, first message line, date). |
| 2026-10-22T11:45:51Z | Plain `git clone --no-checkout` of upstream into `.work/realbugs/R10`; fetched both pinned SHAs. |
| 2026-10-22T11:46–11:47Z | Prefix tree listing, `src/memory/package.json`, `src/memory/README.md` (tool list, `MEMORY_FILE_PATH`); prefix build tree checked out, `npm ci --workspace src/memory`, `tsc`. |
| 2026-10-22T11:47:28Z | Prefix server `tools/list` (create_entities, open_nodes, read_graph schemas). |
| 2026-10-22T11:48:26Z | **Contract written**: `contract.json` sha256 `6c182eb64bea4dfef68123a9f68146b8159296b5a89b560d6d6a27af7ca6fe49`. |

Every later step (first read of the fix diff, human-fix tests, harness) is logged below the
contract section, after this timestamp.

## The contract and why

Symptom (issue): `create_entities` for a name that already exists returns success with the
entity left out of the response, and the new observations are not stored; nothing tells the
agent. Steps: create Alice with "Works at Acme"; create Alice again with "Allergic to
penicillin" → `[]`, no error; `open_nodes(["Alice"])` → only "Works at Acme".

Property `memory.create_entities/readAfterWrite` (kind `readAfterWriteRequested`): after a
non-error `create_entities`, probe `open_nodes(names = every requested name)`. For each
requested entity `e`, the write is *read back* when the probe holds an entity named `e.name`
whose observations include every observation in `e.observations`. If it is not read back, the
call is acceptable only when the response does not list `e.name` among the created entities
and does name `e.name` somewhere else (structuredContent outside `entities`, or a text content
block): that is a signal the agent can see. Otherwise the property is violated.

Choices made blind, before seeing the fix:

- The postcondition accepts either fix direction the symptom allows: store the facts (merge
  observations) or tell the agent which entities were not written. It does not prefer one.
- "Signal" is a mention of the entity's name. A fix that only reports a count ("1 skipped")
  would fail this property; that would be a documented false positive, not tuned away.
- entityType is not compared (the symptom is about observations).
- An `isError` result is unverifiable, as in the fiks evaluator (an explicit error is seen).

## Vocabulary gap (C11)

The fiks `readAfterWrite` postcondition builds probe arguments from the mutating call's
*result* and compares read-back values with *result* paths (`buildProbeArgs`, `getOne`). Here
the result omits the dropped entity, which is the symptom itself, so a result-driven probe has
nothing to read back and passes vacuously. The property therefore uses an args-driven
read-after-write kind (`readAfterWriteRequested`), evaluated by `harness/check.ts`, with the
same property id form (`<contract id>/readAfterWrite`) and the same `Violation`/`EvalResult`
shapes as `@fiks/contracts`. This is a real limit of the frozen vocabulary for this bug class
(omission from a write's response), recorded for the paper's limitations, not a change to
`@fiks/contracts`.

## After the contract (the contract was not edited after 11:48:26Z)

| Time (UTC) | Step |
|---|---|
| 2026-10-22T11:48:48Z | Contract committed on `ws/RB-R10` (`ab4fa21`, "blind contract ... before reading the fix diff"). |
| 2026-10-22T11:48:52Z | **First read of the fix diff** (`git diff --stat` and `git diff -- src/memory/index.ts` prefix..fix), then the test, README and changeset diff. |
| 2026-10-22T11:52:35Z | Private repo `vats98754/rb-r10-servers` created (`gh repo create --private`, not a fork); pushed `main` = prefix and tag `r10-fix` = fix. |
| 2026-10-22T11:53:50Z | `harness/record.ts` recorded `fixtures/state-alice.jsonl` and `fixtures/trigger.json` from the prefix server process. |
| 2026-10-22T11:54:20Z | `run.ts --sha prefix --runs 10`: 10/10 violated; `--sha fix --runs 10`: 10/10 verified. |
| 11:55Z–12:08Z (no exact stamp taken) | Held-out cases written and run on prefix and fix (below). |

What the human fix does (read after the contract): `create_entities` keeps ignoring existing
names (and repeats within one call), adds an optional `skipped: string[]` to the structured
result, appends a second text block "Skipped N entit(y|ies) ...: <names>. ... use
add_observations ...", and changes the tool description. Observations of skipped entities are
still not stored. The blind contract accepts this direction because the response now names the
entity outside `entities` (both in `skipped` and in the second text block).

Post-hoc findings on the held-out inputs (`heldout/run.ts`, the contract column; the contract
was not changed in response):

- **False positive on the fix (H3, same-batch repeat).** `[Ivy("Born in 1990"), Ivy("Vegetarian")]`
  on an empty graph: the fix creates the first Ivy, lists it in `entities` and reports `Ivy` in
  `skipped`. The blind rule treats a name listed as created as a claim that every requested
  item with that name was written, so the second item's missing observation fires. Correct
  head, contract fires: a documented FP of the blind contract on an input it was not written for.
- **False negative on the prefix (H1, mixed batch).** `[Dana(new fact), Erin("Is Dana's sister")]`
  with Dana existing: the prefix drops Dana's fact, but the first text block (the created list
  serialised) contains Erin's observation, which contains "Dana", so the blind "mention" signal
  is satisfied and the contract verifies. The held-out oracle ignores a text block that only
  echoes the created list, so it grades H1 correctly.
- On the trigger itself (the issue's two steps) and the clean control, the blind contract is
  exact: prefix 10/10 violated, fix 10/10 verified, clean control verified on both.
