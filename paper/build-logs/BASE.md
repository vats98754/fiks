# BASE build log

Branch `ws/BASE`, based on main `c144b03`. Wave 1; depends only on CORE-SEED (`@fiks/interfaces`)
and existing main packages (`@fiks/contracts`; `@fiks/vendor-api` as a dev dependency for tests and
the check script). External action: the approved oasdiff install (PLAN 8.0-4), nothing else.

## What landed (`packages/baselines`, `@fiks/baselines`)

One module per PLAN 6.1 baseline. Each is a `Monitor` over `MonitorInput` with a required `id`
(the `DetectorVerdictRow.detector` value). B-OM is cut (PLAN 13) and not built.

| Module | Detector id | What decides the verdict |
|---|---|---|
| `schema.ts` | `B-SCHEMA` | A real `@modelcontextprotocol/sdk` 1.32.0 `Client.callTool` against an in-memory server that serves the recorded tool definition and replays the recorded result. Violated iff the SDK throws. |
| `ajv.ts` | `B-AJV` | Ajv 2020-12 (`strict: true`, `allErrors`, `allowUnionTypes`) + ajv-formats on `strictify(outputSchema)`: closed objects, every property required, formats from descriptions (ISO-8601 -> date-time, URL/URI, e-mail), plus value constraints copied from the vendor OpenAPI response schema of the operation the call hit (format, bounds, lengths, pattern, enum, item counts, multipleOf). |
| `judge.ts` | `B-JUDGE:<model>`, `B-JUDGE+U:<model>` | Injected `llm({model, system, prompt, schema})` (LLMR `complete`); answer JSON `{verdict, property, confidence}`; unparseable = `unverifiable` with `parsed: false`. Every result carries `tokens`, `costUsd`, `promptHash`. |
| `snap.ts` | `B-SNAP` | Diff vs the v1 recording of the same request (tool + canonical args), else vs the tool's v1 profile: field set, JSON types, log10 magnitude bucket, array length vs `total` and vs the recording, `isError`. |
| `stat.ts` | `B-STAT:<aegis\|evidently>:w<20\|50>` | Stateful window per tool, optionally pre-filled with v1 traffic. `aegis`: exact KS per numeric leaf (Bonferroni over leaves, alpha 0.05), null-share jump >= 0.2, share outside the history range >= 0.2 (our parameters, fixed here; AegisFlow released no code). `evidently`: emulation of Evidently's default drift preset (KS / chi-square / z for reference n <= 1000; normed Wasserstein / Jensen-Shannon >= 0.1 above; dataset drift at a drifted-column share >= 0.5) [verify against the pinned Evidently docs]. Unverifiable until the window is full. |
| `trig.ts` | `B-TRIG` | Per call: `isError`, or an `exception`/`error` event. Per drift (facts passed in): oasdiff findings > 0, `pnpm typecheck` fails (`runTypecheck`). |
| `oasdiff.ts` | (B-TRIG input) | Pinned oasdiff 1.33.0 (released 2026-10-01). Refuses any other version. `findings` = max(breaking, changelog entries). |
| `llmc.ts` | `B-LLMC:<domain>-seed<n>` | The fiks evaluator (`@fiks/contracts` `evaluate`) on an LLM-authored contract file. BLIND writes the files at A0 (`packages/contracts/contracts/llm-authored/<domain>-seed<n>.contracts.json`); `loadLlmcMonitors` loads every seed that exists and records the file's sha256. |
| `detect.ts` | | `runDetector(monitor, records, ctx)` -> `DetectorVerdictRow[]` (resets stateful monitors first; `now = capturedAt`); `callsToFirstDetection(rows)`. |
| `stats.ts` | | KS (exact lattice-path p-value), chi-square, z-test, Wasserstein, Jensen-Shannon, Sturges bins. Golden-tested against scipy 1.14.1. |
| `legacy-bench.ts`, `bench-check.ts` | | Read the logged bench proxy logs as CallRecords and tally every deterministic baseline per drift (the acceptance check). |

Scripts (`packages/baselines/scripts/`): `ensure-oasdiff.mjs` (download + sha256 check into
`$HOME/.fiks/tools/oasdiff-1.33.0/`), `capture-tooldefs.ts` (tools/list of a shop-mcp ref through
the SDK client over stdio), `prompt-hashes.ts [--write]`, `check-bench.ts` (acceptance report).

Fixtures: `fixtures/shop-tools.seed-v1.json` = tools/list of shop-mcp `seed-v1`
(`bb037cf8ac313d2ad2c5d683476a527a9147e1c7`), captured with `capture-tooldefs.ts`.

## Judge prompts (hash recorded)

`prompts/judge.v1.md` (B-JUDGE system), `prompts/judge-upstream.v1.md` (B-JUDGE+U system),
`prompts/call.v1.md` (shared user template; upstream exchanges only for +U, 8000 bytes per body).
Hashes in `prompts/HASHES.json`; a test fails if a prompt changes without its hash:

- `call.v1.md` 5929de001f98232ae545e4d45eed187a6aa8ee07583be4f174feef5eaa5a65ce
- `judge-upstream.v1.md` 5c7856ecf40fd8e14b96afb9830b8272d04bf76c046673ce15453550d20dbb8c
- `judge.v1.md` 43a2d234a5fbf986fd734fe0fea33df4c7710687d29107129130a3becc4a4460
- variant B-JUDGE 46cdbfd1ae8b2258bf737c9a26350c5c201811e723bd09b9be17d022d8278b49
- variant B-JUDGE+U 3319e3829eb0a353891d92fb8e44f5182e68132ab601fe12e973407572cc51e4

These are v1 (prompt iteration 0). The <= 5 dev iterations and the variant choice (PLAN 6.1) happen
at run time and are logged in PREREG's TUNING.md, each as a new `*.vN.md` file with its hash.

## Interface notes for DET / LLMR

- `LlmFn = (req: {model, system, prompt, schema?}) => Promise<{text, tokens: {in, out, cacheRead?,
  cacheCreate?}, costUsd}>`. LLMR's `complete` is expected to fit this shape; if it differs, DET
  wraps it (no baseline imports an SDK for model calls).
- CallRecord has no probe field. `toMonitorInput` reads the read-after-write probe from an event
  `{type: 'probe', tool, args, result, http?}` (the proxy's probe shape). DET's recorder should
  emit it that way.
- `runDetector` passes `events` to the monitor (B-TRIG reads `exception`/`error` events).
- `DetectorVerdictRow.tokens` is the sum in + out + cacheRead + cacheCreate.

## Acceptance evidence (round 1)

SETUP: `node packages/baselines/scripts/ensure-oasdiff.mjs` -> installed
`~/.fiks/tools/oasdiff-1.33.0/oasdiff` (sha256 2a479337c15a... of `oasdiff_1.33.0_darwin_all.tar.gz`
matches); `node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile` -> nothing to
apply, install ok. No dependency fragment is needed (no `@fiks/*` import into a package BASE does
not own).

`pnpm vitest run packages/baselines` -> 5 files, 51 tests passed.

`pnpm tsx packages/baselines/scripts/check-bench.ts --replays 20` (exit 0). Inputs: proxy logs of
A_v1_20261018T093357, A_v1_20261020T223642, B_v2_20261018T093754, B_v2_20261020T224015,
C_v2_fixed_20261020T224903 (200 calls) plus one M7 fixture. Fires / calls:

| Detector | D1 | D2 | D3 | D4 | D5 | v2 incidental | v1 | fixed | M7 |
|---|---|---|---|---|---|---|---|---|---|
| B-SCHEMA | 0/10 | 0/10 | 0/10 | 0/13 | 0/10 | 0/34 | 0/74 | 0/39 | 1/1 |
| B-AJV | 0/10 | 0/10 | 0/10 | 0/13 | 0/10 | 0/34 | 0/74 | 0/39 | 1/1 |
| B-SNAP | 10/10 | 10/10 | 0/10 | 11/13 | 0/10 | 34/34 | 0/74 | 0/39 | 1/1 |
| B-TRIG | 0/10 | 0/10 | 0/10 | 0/13 | 0/10 | 10/34 | 0/74 | 0/39 | 0/1 |
| B-LLMC stand-in (hand contracts) | 10/10 | 10/10 | 10/10 | 12/13 | 10/10 | 24/34 | 0/74 | 0/39 | 1/1 |

oasdiff on the vendor spec served at v1 vs v2: `{version 1.33.0, breaking 0, changelog 0}`.
Calls to first detection (window pre-filled with v1 traffic, then one drift's calls in logged
order): aegis w20 D1 6, D2 4, D4 5, D3/D5 never; evidently w20 D1 10, D4 5, others never; both
w50 never (the bench has too few calls to fill a 50-call window). All 9 deterministic detectors
gave 1 distinct verdict hash over 20 replays; the vitest version runs 19 replays plus one under a
+400-day fake system clock and compares hashes.

## Caveats (stated, not hidden)

- **Labels on legacy bench traffic.** In a v2 bench run all five drifts are on at once. A call is
  labelled with its task's drift (trials.jsonl) only when its tool is that drift's surface
  (D1/D4 search_products, D2 get_product, D3 create_order, D5 get_order). The other v2 calls are
  `dev-incidental`. B-TRIG's 10 incidental fires are the agent's follow-up `get_order` on the order
  D3 lost (upstream 404, tool `isError: true`): an explicit, correct error after the silent
  create_order, not a fire on a D1-D5 call. DET's enumerated traffic with v1 controls replaces
  these labels for the paper.
- **M7 fixture** is built by `m7StringPrice` (number -> string on a v1 get_product upstream body
  and on the seed-v1 pass-through output). MUT owns the real M7 operator.
- **B-LLMC** has no LLM-authored contract before A0; the runner is exercised on the hand contracts
  (labelled `standin-shop-hand`), whose verdicts equal the logged receipts on every v1 and v2 call.
- **B-STAT parameters** (Bonferroni alpha 0.05, null jump 0.2, range share 0.2, prefill = v1
  tail) are our design; the Evidently emulation is from memory of its defaults and stays
  `[verify]` until checked against the pinned Evidently docs.
- **B-AJV** sees the tool output only; no semantic invariant is schema-derivable.
- `pnpm-lock.yaml` changes from the new package are not committed (orchestrator regenerates it at
  merge, PLAN 7.1).
