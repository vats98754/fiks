# CORE test fixtures

| File | sha256 | Source |
|---|---|---|
| `D2-trace.json` | `b6baf03ea14d2fb6ce8bc7df91a223df63177c8dfc8995f7ab1f87ef9e524d15` | Byte copy of the gitignored `/Users/anvayvats/fiks/.fiks/traces/tr_079b90c89e.json` from the main checkout (absent from builder worktrees). Captured 2026-10-18 with vendor v2, all five drifts active (`upstream.drifts` = D1..D5); target `shop.get_product/price.notNull`. Also used by ARMS. |

The JSON files here are byte copies: `packages/cli/test/core/biome.json` keeps Biome from
reformatting them, and `packages/cli/test/core/fixtures.test.ts` checks each sha256 against this
table.
