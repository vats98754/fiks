// The PLAN sections PREREG.md must reproduce verbatim, and the named rule classes (the acceptance
// list of the PREREG workstream) located in them by an anchor substring. An anchor must occur in
// at least one block of its section; every block containing it must appear in PREREG.md.

/** PLAN sections reproduced in Part II (every block of each is checked). */
export const SECTIONS = ['3', '4', '5.5', '5.7', '8.2', '9', '13'] as const;

export interface NamedRule {
  category: string;
  id: string;
  section: string;
  anchor: string;
}

const r = (category: string, id: string, section: string, anchor: string): NamedRule => ({
  category,
  id,
  section,
  anchor,
});

export const CATEGORIES = [
  'H endpoint',
  'test',
  'margin and margin rationale',
  'direction guard',
  'reading',
  'n rule',
  'N_E rule',
  'IV definition',
  'REPRO-AGENT F-check rule',
  'H2 as-it-behaves rule',
  'H2 re-record rule',
  'repair-arm re-record parity rule',
  'request-changing class rule',
  'E4/E7 analysis rule',
  'cut-order step',
  'exclusion rule',
  'infra rule',
] as const;

export const NAMED_RULES: NamedRule[] = [
  // H endpoints (and the outcome / correctness definitions they use)
  r('H endpoint', 'H1.Z_e', '3', '**Endpoint and test (confirmatory).** Z_e = 1 iff'),
  r('H endpoint', 'H1.X', '3', 'X = Σ Z_e over the N_E eligible entities.'),
  r('H endpoint', 'H1.decision', '3', '**Decision value entering Holm:**'),
  r('H endpoint', 'H1.census', '3', '(ii) **census condition:** < 1% false positives'),
  r('H endpoint', 'H2.BA', '3', 'BA = 1 − (FAR + FRR)/2 over the primary pool'),
  r('H endpoint', 'H2.BA_agent', '3', 'BA_agent = mean BA over the REPRO-AGENT tests'),
  r('H endpoint', 'H2.delta', '3', 'Δ_i = BA_fiks,i − BA_agent,i.'),
  r('H endpoint', 'H3a.Y', '3', 'Y = 1 iff outcome = `green_incorrect_pr`.'),
  r('H endpoint', 'H3a.d', '3', 'Per drift, p = mean(Y) over models × attempts; d_i = p_L1,i − p_FIKS,i.'),
  r('H endpoint', 'H3b.Y', '3', 'Y = 1 iff outcome = `correct_pr`.'),
  r('H endpoint', 'H4.harm', '3', 'harm: Y = `green_incorrect_pr`;'),
  r('H endpoint', 'H4.benefit', '3', 'benefit: Y = `correct_pr`. A COMP head'),
  r('H endpoint', 'attempt', '3', '**Attempt.** One end-to-end run of one arm'),
  r(
    'H endpoint',
    'correct_pr',
    '3',
    '`correct_pr` = PR exposed ∧ final local CI green ∧ final head held-out-correct;',
  ),
  r('H endpoint', 'green_incorrect_pr', '3', '`green_incorrect_pr` = PR exposed ∧ final local CI green'),
  r('H endpoint', 'held-out-correct', '3', '**Held-out-correct.** Sealed; no arm sees any of it.'),
  r('H endpoint', 'per-drift-rate', '3', 'In H3/H4 the per-drift rate is the equal-weight mean over models'),
  // tests
  r('test', 'family', '3', 'The worst-case Holm level is α = 0.05/4 = 0.0125'),
  r('test', 'H1', '3', 'One-sided exact binomial, H0: π ≥ 0.02; reject iff X ≤ crit(N_E, 0.02, α).'),
  r('test', 'H1.robustness', '3', 'A one-sided 98.75% percentile upper bound on π from a cluster bootstrap'),
  r('test', 'H2', '3', '**Test.** Two-sided sign-flip permutation on Δ_i'),
  r('test', 'H3a', '3', 'Two-sided sign-flip permutation. Equivalence margin ±0.05.'),
  r('test', 'H3b', '3', 'One-sided shifted sign-flip on d_i + δ at α_Holm'),
  r('test', 'H3.IUT', '3', '**p_H3 = max(p_3a, p_3b)**.'),
  r('test', 'H4.IUT', '3', 'p_H4 = max(p_4a, p_4b);'),
  r(
    'test',
    'H4.same',
    '3',
    'H4 uses the same two components, n, σ_d model, power table and wording rules as H3',
  ),
  r('test', 'signflip', '9', 'Sign-flip permutation: exact if n ≤ 20, else 200,000 flips (seed in PREREG).'),
  r('test', 'NI', '9', '**Non-inferiority.** Primary decision = one-sided shifted sign-flip p on d_i + δ.'),
  r('test', 'multiplicity', '9', '**Multiplicity.** Holm over the confirmatory family only.'),
  r('test', 'simulate_null.iii', '9', '**(iii) Shifted sign-flip NI (H3b, H4b).**'),
  // margins and their rationale
  r(
    'margin and margin rationale',
    'H1.pi0',
    '3',
    '(i) **inferential:** a per-entity FP-origin rate π < π0 = 0.02',
  ),
  r('margin and margin rationale', 'H2', '3', 'Equivalence margin for readings: ±0.05 BA.'),
  r('margin and margin rationale', 'H3b', '3', 'd_i = p_FIKS,i − p_L1,i; margin δ = 0.10.'),
  r('margin and margin rationale', 'H3b.rationale', '3', '**Margin rationale [design].** δ = 0.10 absolute.'),
  r('margin and margin rationale', 'H4', '3', 'NI δ = 0.10 (rationale as H3b);'),
  r('margin and margin rationale', 'readings', '3', 'Margins: BA 0.05; harm 0.05; correct-PR 0.10.'),
  // direction guards
  r('direction guard', 'H2', '3', '**Falsified if** mean Δ ≤ 0 or Holm-adjusted p ≥ 0.05.'),
  r(
    'direction guard',
    'H3a',
    '3',
    '**Direction guard (round 4).** H3a counts as rejected only if mean d_i > 0',
  ),
  r(
    'direction guard',
    'H3',
    '3',
    'Falsified if either component fails at its Holm level, or if mean d_i ≤ 0 on H3a.',
  ),
  r('direction guard', 'H4a', '3', 'direction guard as H3a: H4a counts as rejected only if mean d_i > 0'),
  r('direction guard', 'H1', '3', '**Falsified if** Holm-adjusted p_H1 ≥ 0.05'),
  r(
    'direction guard',
    'h3h4_repair',
    '9',
    'harm and NI components with the direction guard (p_3a, p_4a = 1 when mean d_i ≤ 0)',
  ),
  // readings (every row of the 3.5 table, and the H1 robustness reading)
  r('reading', 'CI', '3', 'CI = two-sided 97.5% BCa over drifts (TOST at the worst-case Holm level).'),
  r('reading', 'not-rejected', '3', '| Any H, or any IUT component, not rejected |'),
  r('reading', 'equivalence', '3', '| Equivalence | Claimed only if the CI lies within ±margin. |'),
  r('reading', 'opposite', '3', '| Opposite direction |'),
  r('reading', 'H1-rejected', '3', '| H1 rejected |'),
  r('reading', 'H1-not-rejected', '3', '| H1 not rejected |'),
  r('reading', 'H2-rejected', '3', '| H2 rejected |'),
  r('reading', 'H2-not-rejected', '3', '| H2 not rejected |'),
  r('reading', 'H3-rejected', '3', '| H3 rejected |'),
  r('reading', 'H3a-H4a-not-rejected', '3', '| H3a or H4a not rejected |'),
  r('reading', 'H3-not-E1', '3', '| H3 not rejected; E1 shows L1-noIV harm > L1 |'),
  r('reading', 'H4-not-H3', '3', '| H4 rejected, H3 not |'),
  r('reading', 'harm-not-NI', '3', '| Harm component rejected, NI component not |'),
  r('reading', 'H4-not-rejected', '3', '| H4 not rejected |'),
  r(
    'reading',
    'publishable',
    '3',
    'All readings are publishable as stated. Nothing is reframed after unblinding.',
  ),
  r('reading', 'H1.robustness', '3', 'Reading rule: if H1 rejects but this bound is ≥ 0.02'),
  r('reading', 'methods', '9', '**Readings.** 97.5% BCa CIs and margins per §3.5.'),
  // n rules
  r('n rule', 'conditioning', '3', 'H2–H4 run on detected **test** drifts only.'),
  r('n rule', 'H2', '3', '**Unit, n.** Detected test drifts with ≥ 3 patches per class in the primary pool.'),
  r('n rule', 'H3', '3', '**n.** Detected test drifts (expected ≈ 61, floor 40).'),
  r('n rule', 'underpowered', '3', '**Pre-declared.** H3 and H4 are underpowered at the floor n = 40'),
  r('n rule', 'stop', '8.2', 'Detected test drifts < 40 after top-up → run H2–H4 anyway, MDE stated.'),
  r('n rule', 'floor', '13', 'H1–H4 never drop below the floor of n = 40 drifts (H1: its N_E rule).'),
  r('n rule', 'S4', '13', 'If the fit still fails at step 11, R4 runs at S4 breadth-first'),
  // N_E rule
  r('N_E rule', 'header', '3', '**N_E rule (outcome-free, applied at F4b; no verdict on F exists).**'),
  r('N_E rule', 'step1', '3', 'If N_E < 1,500 or any domain has < 750'),
  r('N_E rule', 'step2', '3', 'If N_E is still < 1,500: test at the realised N_E.'),
  r('N_E rule', 'step3', '3', 'If N_E < 217: H1 is descriptive only'),
  r('N_E rule', 'frame', '5.7', 'The N_E rule is applied at that point.'),
  // IV definition
  r('IV definition', 'header', '3', '**Issue validation (IV).**'),
  r('IV definition', 'command', '3', 'Command: `fiks-iv --trace .alerts/<id>.json` (ARMS)'),
  r(
    'IV definition',
    'ivProperties',
    '3',
    'It replays the frozen trace on a head and evaluates the **ivProperties**',
  ),
  r('IV definition', 'placement', '3', 'IV is pre-PR in L1 (a gate) and post-PR in COMP (part of its CI).'),
  r('IV definition', 'asymmetry', '3', '**Trigger-check asymmetry (round 7, corrected).**'),
  r('IV definition', 'asymmetry.bias', '3', '**Direction of the bias.**'),
  r(
    'IV definition',
    'rerecorded',
    '3',
    'If the head makes upstream requests the frozen trace never recorded',
  ),
  r('IV definition', 'sidecar', '3', 'A sidecar `<trace>.iv.json` (not shown to any agent; sha256 in F9)'),
  // REPRO-AGENT F check
  r('REPRO-AGENT F-check rule', 'inputs', '5.5', '**Inputs.** REPRO-AGENT receives the same alert JSON'),
  r('REPRO-AGENT F-check rule', 'task', '5.5', '**Task.** Write one new test file under `test/`'),
  r('REPRO-AGENT F-check rule', 'budget', '5.5', '**Budget.** 1 session, 30 turns.'),
  r('REPRO-AGENT F-check rule', 'F', '5.5', '**F check** (harness, sandbox image, 3 runs).'),
  r('REPRO-AGENT F-check rule', 'F.load', '5.5', 'load without error;'),
  r('REPRO-AGENT F-check rule', 'F.assert', '5.5', 'report ≥ 1 assertion failure in all 3 runs on base.'),
  r(
    'REPRO-AGENT F-check rule',
    'feedback',
    '5.5',
    '**Feedback.** When the agent ends its turn and F does not hold',
  ),
  r('REPRO-AGENT F-check rule', 'recorded', '5.5', '**Recorded:** the first test (unfiltered, for s1)'),
  r('REPRO-AGENT F-check rule', 'fairness', '5.5', '**Fairness.** The F check uses only base'),
  // H2 as-it-behaves
  r(
    'H2 as-it-behaves rule',
    'fiks',
    '3',
    '**fiks:** the repro FIKS generates from the frozen trace, as it behaves.',
  ),
  r('H2 as-it-behaves rule', 'agent', '3', '**agent (primary):** the final test of each REPRO-AGENT session'),
  r(
    'H2 as-it-behaves rule',
    'sensitivity',
    '3',
    '**Sensitivity rows:** (s1) the first, unfiltered agent test',
  ),
  r(
    'H2 as-it-behaves rule',
    'exclusions',
    '9',
    'In H2, both the fiks and the agent tests count as they behave.',
  ),
  r('H2 as-it-behaves rule', 'accept', '3', '**Accept rule.** Test set T accepts a patch iff'),
  // H2 re-record
  r('H2 re-record rule', 'header', '3', '**Re-record rule (round 4, identical for every test set).**'),
  r(
    'H2 re-record rule',
    'task-text',
    '3',
    'The REPRO-AGENT task text (§5.5) requires the test to load its recording',
  ),
  r('H2 re-record rule', 'overlay', '3', 'Per patch, `accept()` (CORE `rerecord-head`'),
  r('H2 re-record rule', 'inline', '3', 'A recording inlined in a test file cannot be re-recorded.'),
  r('H2 re-record rule', 'then', '3', 'Only then are the checks evaluated.'),
  r('H2 re-record rule', 'task-sentence', '5.5', 'do not copy it into the test.'),
  // repair-arm re-record parity
  r(
    'repair-arm re-record parity rule',
    'header',
    '3',
    '**Re-record parity (round 5; every arm, every replay-based check).**',
  ),
  r(
    'repair-arm re-record parity rule',
    'rule',
    '3',
    'Rule: CORE `rerecord-head` runs on the candidate head before **every** check',
  ),
  r('repair-arm re-record parity rule', 'mechanism', '3', 'Mechanism: one `rerecord()` code path'),
  r('repair-arm re-record parity rule', 'where', '3', 'Where it runs (round 6):'),
  r(
    'repair-arm re-record parity rule',
    'stale',
    '3',
    're-records stale suite recordings as `*.rerecorded.json`',
  ),
  r('repair-arm re-record parity rule', 'overlay', '3', 'for every other recording file a check reads'),
  r(
    'repair-arm re-record parity rule',
    'agent',
    '3',
    'The agent never re-records and never edits recordings, in any arm.',
  ),
  r('repair-arm re-record parity rule', 'log', '3', 'Each attempt stores its `RerecordLog`'),
  r(
    'repair-arm re-record parity rule',
    'product',
    '3',
    "This is the product's behaviour (FIKS runs `rerecordStale` before its gates;",
  ),
  // request-changing class
  r(
    'request-changing class rule',
    'definition',
    '3',
    '**Request-changing drift (round 5).** A drift is request-changing iff',
  ),
  r('request-changing class rule', 'per-class', '3', '**Per drift class (round 5, descriptive).**'),
  r(
    'request-changing class rule',
    's3',
    '3',
    '(s3, round 5) the primary comparison without request-changing drifts',
  ),
  // E4 / E7
  r('E4/E7 analysis rule', 'E4', '4', '| E4 | Benign evolution (X21, SYN H18) |'),
  r('E4/E7 analysis rule', 'E7', '4', '| E7 | Real bugs, wave 1 (SYN H14, H15) |'),
  // cut order
  r('cut-order step', 'header', '13', '**K1 cut order (pre-registered).**'),
  r('cut-order step', '1', '13', '| 1 | COMP-plain (E8) |'),
  r('cut-order step', '2', '13', '| 2 | L1p |'),
  r('cut-order step', '3', '13', '| 3 | COMP-norep rung |'),
  r('cut-order step', '4', '13', '| 4 | L1-noIV rung |'),
  r('cut-order step', '5', '13', '| 5 | Adaptive attacker |'),
  r('cut-order step', '6', '13', '| 6 | R7 to 6 payloads'),
  r('cut-order step', '7', '13', '| 7 | Real bugs beyond 2 |'),
  r('cut-order step', '8', '13', '| 8 | **S0 → S2**'),
  r('cut-order step', '9', '13', '| 9 | **S2 → S3**'),
  r('cut-order step', '10', '13', '| 10 | Top-up wave A2 |'),
  r('cut-order step', '11', '13', '| 11 | **S4**'),
  r('cut-order step', 'walk', '8.2', 'walk the §13 K1 order, stopping at the first prefix that fits.'),
  // exclusions
  r(
    'exclusion rule',
    '1',
    '9',
    'Drifts and benign cases that fail automated validity before unsealing (F7).',
  ),
  r('exclusion rule', '2', '9', 'Drifts with a forbidden read in the authoring audit.'),
  r('exclusion rule', '3', '9', 'Undetected drifts: excluded from H2–H4 by design'),
  r('exclusion rule', '4', '9', 'Drifts with < 3 patches in a class (H2 only).'),
  r('exclusion rule', '5', '9', 'Persistent-infra cells (pairwise).'),
  r('exclusion rule', '6', '9', 'Frame inputs where the base output ≢ `truth()` on v1'),
  r('exclusion rule', 'F-gate', '9', 'F-gate failures are FIKS outcomes (`no_pr`) and are never excluded.'),
  // infra
  r('infra rule', 'api', '9', '**API-call level.** 3 retries with backoff.'),
  r('infra rule', 'attempt', '9', '**Attempt level.** `infra_error` covers'),
  r('infra rule', 'requeue', '9', 'It is re-queued ≤ 2 times.'),
  r(
    'infra rule',
    'drop',
    '9',
    'If it persists, the (drift, model, attempt-index) cell is dropped **for all arms** and counted.',
  ),
  r('infra rule', 'model', '9', '**Model outcomes, not infra.**'),
  r('infra rule', 'differential', '9', '**Differential infra.**'),
  r('infra rule', 'stop', '8.2', 'Infra > 10% in a 50-attempt window → pause, fix, resume (deviation).'),
];

/** Registered constants Part I must declare (PLAN: "seed in PREREG", `--seed <s>`). */
export const REQUIRED_CONSTANTS: Record<string, 'int' | 'number'> = {
  'alpha.family': 'number',
  'holm.m.planned': 'int',
  'signflip.flips': 'int',
  'signflip.exact_max_n': 'int',
  'bca.resamples': 'int',
  'cluster_bootstrap.resamples': 'int',
  'seed.signflip.H2': 'int',
  'seed.signflip.H3a': 'int',
  'seed.signflip.H3b': 'int',
  'seed.signflip.H4a': 'int',
  'seed.signflip.H4b': 'int',
  'seed.signflip.E4.current_vs_cu': 'int',
  'seed.signflip.E4.comp_vs_cu': 'int',
  'seed.signflip.E11': 'int',
  'seed.bca': 'int',
  'seed.cluster_bootstrap.H1': 'int',
  'seed.frame.enumerate': 'int',
};

/** Constants whose value PLAN itself fixes; PREREG may not state another. */
export const PLAN_FIXED_CONSTANTS: Record<string, number> = {
  'alpha.family': 0.05,
  'holm.m.planned': 4,
  'signflip.flips': 200000,
  'signflip.exact_max_n': 20,
  'bca.resamples': 10000,
  'cluster_bootstrap.resamples': 10000,
};

/** Sentences PLAN requires PREREG itself to state (outside the verbatim copy). */
export const REQUIRED_STATEMENTS: { id: string; text: string }[] = [
  {
    id: 'H3/H4 power at less favourable truths (PLAN 3.3)',
    text: 'if the true correct-PR cost is 0.03–0.05 or the true harm gap is 0.05, H3/H4 are more likely than not to be "not established" at every configuration.',
  },
  {
    id: 'frame rules fixed here (PLAN 3.1)',
    text: 'The frame rules are fixed here (§3.1 "Frame rules are fixed in PREREG").',
  },
];

export const FILL_MARKER = '<<FILL@';
