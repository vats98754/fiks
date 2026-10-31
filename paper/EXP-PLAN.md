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

## Addendum E-A2: ALERT+ arm (2026-10-31, written before any ALERT+ run)

Motivation: in E-A the ALERT gates passed patches that failed the live check, while the FIKS and NOHINT gates agreed with the live check. ALERT differs from FIKS both in what the agent sees (no contract, no repro test, no hints) and in the gates (no replay of the triggering call). ALERT+ separates the gate difference from the input difference.

- **Arm ALERT+:** the ALERT prompt byte for byte (same builder, same inputs; the run records' `promptSha256` per drift must equal ALERT's). The agent never sees a repro test: before the attempt fiks runs the F gate on seed-v1 and then removes the generated files from the checkout. After the attempt, fiks generates the repro test for the trace, commits it on top of the start commit, and runs it as a gate together with the ALERT gates: guard, re-record if stale, **repro (P)**, suite, typecheck, lint, integrity. The head keeps only the agent's `src/` bytes and fiks re-recordings outside `test/repro/` (as in ALERT); exp-eval adds its own held-out repro as for every arm.
- **One attempt, no feedback:** as in every E-A arm, a failed gate is not reported back to the agent. The added gate therefore cannot change the patches, only which patches pass. ALERT+ patches are new samples from the ALERT prompt.
- **Runs:** D1–D5 × 3 reps = 15, same model, caps, sandbox and tools image as E-A (`FIKS_TOOLS_IMAGE` pinned to the E-A image).
- **Readouts (descriptive):** (1) runs whose gates pass and whose live check fails, ALERT+ vs ALERT (does a trigger-replay gate stop them?); (2) runs whose gates fail and whose live check passes (does it block good patches?); (3) live-check success of ALERT+, and FIKS vs ALERT+ by exact sign test over drifts; (4) ALERT and ALERT+ pooled as 30 samples of the ALERT prompt, reported in addition, never instead of the per-arm numbers.
- Stop rules as above. No other arm is re-run.
