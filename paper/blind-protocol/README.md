# Blind-authoring protocol (stream BLIND; PLAN 5.1-5.3, 8.1 A0/A1/A2)

The pipeline lives in `packages/authoring` and runs only in A0, A1 and A2, never during the build.
`briefs/` holds every authoring brief; each brief and both domains' docs are hashed at F2 by
`pnpm fiks author --check-no-bounds` (the printed sha256 values go into the F2 ledger entry).

## Commands

| Run | Command |
|---|---|
| F2 check | `pnpm fiks author --check-no-bounds` |
| A0(a) catalog | `pnpm fiks author --kind catalog --domain <d> --batches <n>`; before F4b, `--top-up` |
| A0(b) tracker contracts | `pnpm fiks author --kind contract --domain tracker` (protocol `tracker`) |
| A0(b) shop-blind | `pnpm fiks author --kind contract --domain shop` (protocol `shop-blind`) |
| A0(b) B-LLMC | `pnpm fiks author --kind contract --domain <d> --protocol llm --seed <1..3> [--sdev-records <A0 S-dev CallRecords.jsonl>]` |
| A1 ideation | `pnpm fiks author --kind ideas --domain <d> --stratum realistic\|evasive\|benign --n <N> --seed <s>` |
| A1 implementation | `pnpm fiks author --kind drift\|evasive\|benign --domain <d> --ideas <blind>/ideas/<d>-<stratum>.jsonl --throughput paper/results/raw/throughput.json --ceiling-usd 1000 --ceiling-sessions 520` |
| R0 validity | `pnpm fiks validate-drift <blind>/drifts/<id>.json --require-ref-b` |
| F7 split | `pnpm fiks split --seed <s>` (reads `<blind>/kept.json`) |

`--llm-stub <module>` replaces every LLM call by a stub author (tests and dry runs). Without it the
command refuses to run while `$HOME/.fiks/build-swarm.active` exists.

## Reserved run outputs (written by run steps only; `--out-root` prefixes them)

- `packages/contracts/contracts/tracker-mcp.contracts.json` + `AUTHORING-tracker.md`
- `packages/contracts/contracts/shop-blind.contracts.json` + `AUTHORING-shop-blind.md`
- `packages/contracts/contracts/llm-authored/<domain>-seed<n>.contracts.json` + `AUTHORING-<domain>-seed<n>.md`
- `packages/vendor-api/catalog/extended.json`, `packages/vendor-tracker/catalog/extended.json`
  (+ `AUTHORING-catalog.jsonl` beside each)
- `paper/results/raw/A0/<label>/` (contract and catalog transcripts and tool logs)
- the driftbench-blind checkout (default `.work/driftbench-blind`, `--blind-repo`): `ideas/`,
  `drifts/<id>.json` + `drifts/<id>/`, `transcripts/`, `quarantine/`, `kept.json`,
  `A1-report.json`, `split.json`; pushed to the private `vats98754/driftbench-blind` at F6.

## Exports

Every session runs in an export: a directory outside `~/fiks` (default `$TMPDIR/blind-exports`)
built from an explicit file list, with its manifest beside it (`<dir>.manifest.json`). The deny
list (`test/fiks/**`, `*.contracts.json`, `evaluate.ts`, `test/repro/**`, `test/traces/**`, `.git`,
and any file containing `fiks_receipt`, `@fiks/` or `outcome contract`) applies to every kind;
denied files are listed under `excluded` in the manifest.

| Kind | Contents |
|---|---|
| catalog | `docs/` + `BRIEF.md` |
| contract-author | `docs/` + `calls/` (30 original-catalog v1 calls, round-robin per tool, seed `contract-author-v1`) |
| contract-llm | `tools/tools.json` + `calls/` (20 S-dev records) |
| drift, evasive, benign | the server at base (repo layout) + `blind/` (docs, vendor v1 source, brief, taxonomy, idea) |
| fixer | the server at base + `test/hidden/` + `blind/` (docs, vendor source, brief, `DRIFT.md`, the rewriter); never ref A |
| rater | `docs/` + `BRIEF.md` + `DRIFT.md` + the rewriter |

Sessions: LLMR `agentSession` with `settingSources: []`, cwd = the export, no web tools, every
tool call through a permission hook that keeps paths inside the export and runs Bash in a
`--network none` container (relayed output). Every tool call is logged; transcripts are audited
for forbidden reads, web tools and sentinel strings, and a failed audit excludes the output.

## Rules

- Keep rule: first valid in idea-index order until each stratum quota is met (45 realistic,
  15 evasive with at least 5 plausible-string, 15 benign per domain).
- Ref B: an independent fixer on every kept drift; a drift whose ref B fails validity is dropped
  and the keep rule is re-applied.
- Cap-stop: on a usage cap every session pauses, in-flight sessions are discarded (quarantined)
  and re-run from scratch after the reset; the ceiling ($ and sessions) stops A1.
- Benign changelog: a seeded half of the benign cases keep the author's changelog entry.
