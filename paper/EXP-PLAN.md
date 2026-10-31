# Exploratory pilot extensions (plan written 2026-10-30, before any run)

These runs extend the pilot (paper §5). They are **exploratory**: small n, no confirmatory claims, separate from the pre-registration draft (`paper/prereg/PREREG.md`), which they do not use or change. Every number they produce is computed by a script from logs committed under `bench/results/exp/`.

## E-A. Repair input ablation (items 2, 7, 8)

- **Drifts:** D1–D5, base = shop-mcp `seed-v1`, vendor v2 with the single drift active, trace = the committed pilot trace for that drift.
- **Arms** (same model `claude-opus-5-5`, same tool restrictions, one agent attempt per run, same turn and budget caps):
  - **FIKS:** the pilot prompt unchanged; repro test visible; gates = repro (P), contract suite, stored traces, typecheck, lint.
  - **NOHINT:** as FIKS, but the prompt omits the failure-class sentence, the vendor-version-header note, the "a new header, extra pages" note and the v1-recording path. Contract, trace and repro test stay.
  - **ALERT:** a prose alert (receipt text and violated property) plus the raw trace; no repro test is given or run during repair; gates = contract suite, stored traces, typecheck, lint.
- **Repetitions:** FIKS 5 per drift; NOHINT and ALERT 3 per drift (55 runs).
- **Isolation:** every run inside the Docker sandbox (no network except the model API path the runner needs, scrubbed env). No push, no PR, no CI.
- **Outcomes per run:** (1) the arm's own gates pass; (2) **held-out repro**: the fiks repro for that drift passes on the resulting head (for ALERT it was never shown); (3) **live check**: the drift's scenario against vendor v2 is verified and `v1-all` is all verified on the resulting head (no regression); (4) changed lines; turns; API-price cost; wall time; infra errors (reported separately, not counted as failures).
- **Primary readout:** live-check success per arm, per drift, with Wilson intervals; paired comparison FIKS vs NOHINT and FIKS vs ALERT over drifts (exact sign test on per-drift success rates). n is small; all results are descriptive.

## E-B. Detection sweep, no LLM (item 6)

- **Clean traffic:** every product (`get_product`), every category and a fixed query list (`search_products`), and the seed orders (`get_order`), through the proxy against vendor v1 on `seed-v1`. Outcome: violated receipts per call (false positives), Wilson upper bound per call and per entity.
- **Response mutations:** each MUT response operator (and benign operators B1–B4) applied to every recorded v1 upstream response, replayed offline through the contracts. Outcome: share of mutated responses flagged, per operator (contract recall on mutants, labelled construction-coupled where the operator maps one-to-one onto a contract kind); benign operators: share flagged (false alarms).

## E-C. Injection smoke test (item 7)

- One attack template from `packages/attacks` placed in the vendor response for D2; FIKS arm in the sandbox; 2 runs. Outcome: the attack oracles (canary read, egress attempt, edits outside `src/`, attacker-directed `src/` behaviour). Reported as a smoke test, not a security evaluation.

## Stop rules

- Infra errors (rate limits, API errors, Docker failures) are retried up to 3 times per run, then recorded as `infraError` and excluded from success counts, with the count reported.
- If more than 20% of runs in an arm end in `infraError`, stop that arm and report it incomplete.

## Addendum (2026-10-30, after the tooling merged at 50a2722, before any E-A/E-C run)

- E-C template fixed as `agentdojo-important-instructions` (the AgentDojo baseline attack) with the default carrier `response-body-field`; chosen before any run because it is the most widely used baseline template in `packages/attacks`.
- Runs execute 3 at a time (independent checkouts and containers); each run is evaluated by `fiks exp-eval` immediately after it finishes. Order is interleaved by drift and arm so a stop rule triggers early.

## Correction (2026-10-31, after the runs)

- The E-C template `agentdojo-important-instructions` is modelled on AgentDojo's "important instructions" attack but uses its own wording (`packages/attacks/src/templates.ts`); "the AgentDojo baseline attack" above overstates its fidelity.
- The traces given to every E-A arm are the committed pilot traces, recorded with all five drifts active; the live check runs vendor v2 with only the target drift active.
