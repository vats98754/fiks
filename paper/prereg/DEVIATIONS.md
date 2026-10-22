# Deviations from the pre-registration

PLAN §9.5. Every departure from `PREREG.md` (tag `prereg-v1`) or its K1 addendum (`prereg-v1.1`) is logged here, and both analyses are reported. Registered as deviations by PLAN (non-exhaustive):

- any post-F5 change to code that affects verdicts (the affected cells are re-run);
- an A0 contract edit other than the registered mechanical disable (`scripts/contract-disable.mjs`, frozen at F2);
- a catalog top-up after F4b;
- a range widened after F4b (§3.1; both results are reported);
- a change to the fiks repair prompt or repro generator after this plan (§5.2 item 5);
- a determinism break (D1 mismatch) or infra > 10% in a 50-attempt window, with the fix and re-run (§8.2 stop rules);
- a disagreement between Part I and Part II of `PREREG.md` (Part II governs).

No interim looks: runners print status counts only (§9.5). A deviation never rescues a failed hypothesis; the pre-registered analysis stays the primary one.

| # | Date (UTC) | Item (PREREG / PLAN section) | What changed | Reason | Who decided | Affected runs / cells | Result under the registered analysis | Result under the deviation | Commit |
|---|---|---|---|---|---|---|---|---|---|

No deviation is recorded.
