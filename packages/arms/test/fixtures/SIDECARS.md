# ARMS frozen-trace fixtures and IV sidecars

ARMS does not depend on DET, so it builds its own frozen traces and hand-writes their
`<trace>.iv.json` sidecars in DET's format (`controlCallId`, `attributableProperties`,
`ivProperties`, `ivExcluded[{property, controlVerdict}]`; PLAN 3.0, Appendix `FrozenTrace`).

## How the traces are made

`packages/arms/test/support/fixtures.ts` (`pnpm tsx packages/arms/test/support/fixtures.ts --write`):
the CORE harness (`startHarness`, through fiks-proxy with the frozen contracts) on a checkout of the
drift's base, vendor v1 with the drift's injector rule as upstream middleware (packages/injector
`startInjector`, registered for the test as the harness's injector factory), under the Domain's
frozen clock `2026-10-01T12:00:00.000Z`, saved with the existing trace store (`traceFromCall`, the
`saveTrace` serialization). The tap's wall-clock fields of each exchange (`startedAt`,
`durationMs`) are set to the frozen clock and 0 so a regeneration is byte-identical
(`test/iv.test.ts` regenerates every trace and compares bytes). Each trace keeps the full receipt
`violated` list; `target` = [the first drift-attributable entry].

| Trace | Base | Rule | Call | Contracts |
|---|---|---|---|---|
| `D3.trace.json` (tr_b703bf79d0) | seed-v1 | INJ D3 | `create_order {items:[{product_id:p-1004, quantity:2}]}` | shop |
| `D4.trace.json` (tr_c3cb09411c) | seed-v1 | INJ D4 | `search_products {query:cable}` | shop |
| `D4-plantedfp.trace.json` (tr_47828c0b12) | seed-v1 | INJ D4, vendor catalog `all` + `D4-plantedfp.extended.json` | `search_products {query:laptop}` | shop |
| `TRK-DEV-1.trace.json` (tr_bc59dbbff1) | dev-tracker-stub | DOM2 TRK-DEV-1 | `list_comments {issue_key:TRK-104}` | DOM2 dev stub |
| D2: `packages/cli/test/core/fixtures/D2-trace.json` (tr_079b90c89e, CORE's) | (captured 2026-10-18, vendor v2, D1-D5) | none | `get_product {id:p-1001}` | shop |

The planted-FP extension holds two laptops: `px-arms-budget-laptop` at $9 and
`px-arms-studio-laptop` at $999. The `all` catalog appends extended entities after the 15 original
products and the D4 page holds 5 items, so a one-product extension can appear on the first page
only when the query matches at most 4 originals, i.e. when there are at most 5 matches and nothing
is paginated. With the 4 original laptops plus two extended ones (6 matches), the first page ends
with the $9 laptop and the second page holds the in-range one. Deviation from the WORKSTREAMS text
("a one-product extension"), recorded in paper/build-logs/ARMS.md.

## v1 control runs (the verdicts the sidecars are derived from)

The control of a trace is the same call on the same base, same clock and same catalog, vendor v1,
no injector rule (D2: the trace's own upstream clock 2026-10-18T09:22:20.182Z). A property is
`verified` when it was checked and not violated, `violated` when violated, `unverifiable` when not
checked. ivProperties = the triggering contract's properties verified on the control; ivExcluded =
the rest; attributableProperties = the trace's violated properties verified on the control.
Recorded from `pnpm tsx packages/arms/test/support/fixtures.ts` on 2026-10-22 (and re-derived by
`test/iv.test.ts` on every run):

| Trace | Property | Control verdict | Violated on the trace |
|---|---|---|---|
| D2 | shop.get_product/outputSchema | verified | |
| D2 | shop.get_product/price.notNull | verified | yes (attributable, target) |
| D2 | shop.get_product/price.range | verified | |
| D3 | shop.create_order/outputSchema | verified | |
| D3 | shop.create_order/total.range | verified | |
| D3 | shop.create_order/readAfterWrite | verified | yes (attributable, target) |
| D4 | shop.search_products/outputSchema | verified | |
| D4 | shop.search_products/items.price.range | verified | |
| D4 | shop.search_products/countMatchesTotal | verified | yes (attributable, target) |
| D4 | shop.search_products/total.equalsUpstream | verified | |
| D4 | shop.search_products/items.id.unique | verified | |
| D4 | shop.search_products/items.nonEmpty | verified | |
| D4-plantedfp | shop.search_products/outputSchema | verified | |
| D4-plantedfp | shop.search_products/items.price.range | **violated** ($9 item) | yes (not attributable) |
| D4-plantedfp | shop.search_products/countMatchesTotal | verified | yes (attributable, target) |
| D4-plantedfp | shop.search_products/total.equalsUpstream | verified | |
| D4-plantedfp | shop.search_products/items.id.unique | verified | |
| D4-plantedfp | shop.search_products/items.nonEmpty | verified | |
| TRK-DEV-1 | tracker.list_comments/outputSchema | verified | |
| TRK-DEV-1 | tracker.list_comments/countMatchesTotal | verified | yes (attributable, target) |
| TRK-DEV-1 | tracker.list_comments/total.equalsUpstream | verified | |
| TRK-DEV-1 | tracker.list_comments/items.id.unique | verified | |

`controlCallId` is `control-<trace id>` (ARMS's naming; DET's call ids differ, and INTEG compares
only attributableProperties, ivProperties and ivExcluded).
