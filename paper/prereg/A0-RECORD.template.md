# A0 record (template)

Copy to `paper/prereg/A0-RECORD.md` and fill in during A0 (PLAN §8.1 row A0). A0 is **record-only**: no contract is iterated on S-dev, and the only registered edit is the mechanical disable below. The completed file is hashed into the F4 ledger entry (`contracts-frozen-v1`) and must exist before F4b. Every value comes from a logged command; paste the command next to it. Leave nothing blank: write "none" or "not run (reason)".

## 0. Preconditions

| Check | Value |
|---|---|
| F2 `freeze-vocab` recorded in the ledger (`pnpm tsx paper/prereg/check-ledger.ts` PASS) | |
| T0 throughput probe done; concurrency used for A0 | |
| `$HOME/.fiks/build-swarm.active` absent (no builder swarm during live runs, PLAN §7.1) | |
| fiks commit A0 ran from (clean tree) | |
| Run window start (UTC) / end (UTC) | |

## (a) Catalog extension (PLAN §5.1, §3.1 Frame F)

The catalog author sees no contracts; independent batches of 25; disjoint id namespace; `authorBatch` recorded per entity.

| Domain | Batches authored | Entities authored | Entities in the extended catalog | Extended catalog file | sha256 | Command |
|---|---|---|---|---|---|---|
| shop | | | | | | `pnpm fiks author --kind catalog --domain shop --batches <n>` |
| tracker | | | | | | `pnpm fiks author --kind catalog --domain tracker --batches <n>` |

Forbidden reads in the catalog-author sessions (audit): <none / list>.

## (b) Contracts (PLAN §8.1 A0(b), §6.1 B-LLMC)

| Contract | Protocol | Seed | Output path | sha256 | AUTHORING log | Command |
|---|---|---|---|---|---|---|
| tracker (primary) | tracker | — | `packages/contracts/contracts/tracker-mcp.contracts.json` | | `AUTHORING-tracker.md` | `pnpm fiks author --kind contract --domain tracker --protocol tracker` |
| shop-blind (sensitivity) | shop-blind | — | `packages/contracts/contracts/shop-blind.contracts.json` | | `AUTHORING-shop-blind.md` | `pnpm fiks author --kind contract --domain shop --protocol shop-blind` |
| LLM-authored shop | llm | 1 | `packages/contracts/contracts/llm-authored/shop-seed1.contracts.json` | | | |
| LLM-authored shop | llm | 2 | | | | |
| LLM-authored shop | llm | 3 | | | | |
| LLM-authored tracker | llm | 1 | | | | |
| LLM-authored tracker | llm | 2 | | | | |
| LLM-authored tracker | llm | 3 | | | | |

The tracker contract author saw only the tracker docs and the 30 original-catalog v1 calls (export file list attached or hashed: ).

## (c) S-dev record (no iteration; D11)

Frozen primary contracts on S-dev traffic: the original catalogs, the 30 tracker contract-author calls, shop `knownGoodInputs` and v1 fixtures, all A0 validation traffic (PLAN §3.1 "Outside F").

| Domain | S-dev calls | Calls with ≥ 1 violated primary property | Properties that fired (id: count) | Records path + sha256 |
|---|---|---|---|---|
| shop | | | | |
| tracker | | | | |

### Registered response: mechanical disable

If a primary property fires on S-dev, the only registered response is `node scripts/contract-disable.mjs --ids <ids> --reason S-dev`, which sets `disabled: true` on exactly those ids (PLAN §8.1 A0, §9.5). Any other contract edit is a deviation (log it in `DEVIATIONS.md`).

| Contract | Property ids disabled | Command + output line | Re-vendored into tracker-mcp by ORCH `seed-tag` (commit) | Tracker base CI green |
|---|---|---|---|---|
| | none | | | |

H1 sensitivity re-enables these offline with MON `replay-cli --reenable <ids>` (`now := capturedAt`).

## (d) Vendor into tracker-mcp and tag `seed-tracker-v1`

| Item | Value |
|---|---|
| tracker-mcp commit carrying the frozen contract and the F2 evaluator | |
| `seed-tracker-v1^{commit}` (peeled; record this, never the tag object) | |
| `git -C .work/tracker-mcp cat-file -t <that sha>` prints `commit` | |
| tracker-mcp CI on that commit | |

## Usage

| Item | Value |
|---|---|
| Sessions / calls (Opus) | |
| API-price estimate (USD, `total_cost_usd`, an estimate under OAuth) | |
| Cap or usage-limit events (time, action taken) | |

## Sign-off

- Recorded by / date (UTC):
- Ledger entry F4 filled (`files` includes `paper/prereg/A0-RECORD.md`), `check-ledger.ts` PASS:
