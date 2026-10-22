# MON build log

Branch `ws/MON`, based on main `c144b03`. Wave 1, depends on CORE-SEED only. No external actions.

## What landed (PLAN P9)

- **Monitor hook** (`packages/proxy/src/monitor.ts`, `proxy.ts`). `ProxyOptions.monitor` takes a
  `Monitor` (`@fiks/interfaces`) or `'none'`. The default is `contractsMonitor()`, which calls
  `evaluate()` from `@fiks/contracts`. `ProxyOptions.contracts` is now optional and is required
  only for the contracts monitor. Every recorded call carries:
  - `monitor` (id) and `monitorMs` (latency; 0 under `none`);
  - `at` (the `now()` instant passed to the monitor; under `none`, the instant that would have
    been used);
  - `upstreamObserved` and `toolDef` (the tools/list entry, so offline replay needs no upstream);
  - `logOnly`, `monitorError`, `costUsd` and `tokens` when they apply.
- **Callbacks.** `onCall(CallRecord)` behaves as before: it runs only for calls a monitor
  evaluated, and its `receipt` is still required, so CORE's `scenario.ts`, `bench.ts` and
  `trace-store.ts` compile unchanged. The new `onRecord(RecordedCall)` runs for every call, also
  under `none`, and `bin.ts` writes `--events` from it.
- **Live receipts are unchanged.** The receipt gains `disabled[]` (VOCAB round 6) only when it
  is non-empty, so nothing changes for the shop contracts. The live proxy never passes evaluator
  options: the monitor test spies on `evaluate` and its third argument is `undefined` on every
  call.
- **`fiks-proxy` bin.** `--monitor contracts|none|<module path>` loads a module's default
  export, whose id is `fn.id` or else the path. `--log-only` evaluates and logs the verdict, but
  leaves the upstream result and tools/list untouched: no `_meta`, no text block, no receipt
  field. Under `--monitor none`, `--contracts` is never read, no read-back probe runs and no
  receipt is attached.
- **`replay-cli`** (`packages/proxy/src/replay-cli.ts`, library in `replay.ts`). It reads two
  record formats: `fiks-proxy --events` lines, and the paper `CallRecord` (its proxy event, if
  any, sits in `events[]`). It evaluates with `now := new Date(record.at ?? record.capturedAt)`
  and has no other clock source. A record with neither field exits 2.
  - `--in … --out rows.jsonl` writes `DetectorVerdictRow`s: one per violation, or one row with
    `property: null` for a record without violations.
  - `--per-element` passes `perElement: true` to the evaluator and fills `at` and `elementIndex`.
    `elementIndex` is the innermost `[n]` of the violation path.
  - `--reenable a,b` passes `reenable`.
  - `entityClass` and `originUnit` are looked up from the record by concrete path, then by the
    `[*]` path, then `$`, else `unknown`.
  - Cost and tokens are per call and sit on the call's first row only.
  - `--check` rebuilds every logged receipt and exits 1 unless each verdict (verdict, contractId,
    checked, violations, disabled) is byte-identical. It also counts whole-receipt identity and
    names the other fields that differ.
- **`packages/proxy/fixtures/shop-mcp.tools.json`.** shop-mcp's tools/list, captured over stdio
  at `bb037cf` (seed-v1) and `7bf2e66` (main); the two captures are byte-identical. Proxy logs
  written before this stream carry no `toolDef`, and `outputSchema` is checked against the
  declared schema. So this file is replay's default `--tools`, used only with the default (shop)
  contracts.
- **Test preloads.** `test/support/clock-shift.cjs` shifts `Date`, `new Date()` and `Date.now()`
  by `FIKS_TEST_CLOCK_SHIFT_DAYS`. `test/support/fs-spy.cjs` logs every path opened through
  node:fs.
- `deps-fragments/MON.json` adds `@fiks/interfaces` to `packages/proxy`. The `package.json` and
  lockfile edits are applied locally and not committed (PLAN 7.1).

## Evidence (2026-10-21, base c144b03)

- `pnpm vitest run packages/proxy packages/cli/test/proxy-bin.test.ts`: 11 files; 63 passed, 1
  skipped (see "Blocked" below).
- `pnpm tsx packages/proxy/src/replay-cli.ts --monitor contracts --check bench/results`: "checked
  200 logged receipts in 158 files: verdicts 200 byte-identical, 0 different; whole receipt 175
  byte-identical (other fields differ: hints x25)", exit 0.
  - All 25 `hints` differences are in `B_v2_20261018T093754`. Receipt hints arrived in `705e989`
    (2026-10-20), after that run.
  - Every other run's receipts are byte-identical as whole receipts.
  - Negative control: with an empty `--tools` file, only 10 of 200 verdicts match.
- `--log-only` on shop v2 D2 (`proxy-bin.test.ts`):
  - the results of `get_product p-1001` and `p-1004` and the tools/list through the proxy are
    `JSON.stringify`-identical to a direct shop-mcp client;
  - events hold `receipt.verdict = violated` with `shop.get_product/price.notNull`, plus
    `logOnly`, `monitor`, `monitorMs` and `upstreamObserved`.
- `--monitor none` (`proxy-bin.test.ts`):
  - events hold `result` and `http` (`/products/p-1001`), with no `receipt`, `probe`, `verdict`,
    `violations` or `checked`;
  - `create_order` caused exactly one upstream request (`POST /orders`), so no probe ran;
  - the fs spy (an `NODE_OPTIONS` preload) shows the private contracts copy is never opened. A
    control run with `--monitor contracts` shows the same spy logging that path.
- Clock shift (`clock-shift.test.ts`):
  - the fixture is live proxy calls under a frozen clock (get_order created 1 day, 200 days and
    about 56 years before it, plus a search), plus one paper-format record that has `capturedAt`
    only;
  - `replay-cli` run normally and under `node --require .../clock-shift.cjs` with
    `FIKS_TEST_CLOCK_SHIFT_DAYS=400` writes byte-identical JSONL;
  - the preload is checked to shift `Date.now()` and `new Date()` by 400 days;
  - the fixture is clock-sensitive: at the shifted instant, freshness flips for the 1-day and
    200-day orders;
  - in-process, `vi.setSystemTime(+400 d)` also gives identical rows.
- Refusals: a record without `at` or `capturedAt` exits 2, in both formats. `--reenable x`
  reaches the evaluator as `{reenable: ['x']}` (spy). With no flags, no options are passed.
- Per-element (`replay.test.ts`):
  - on a live search with ext-a $9, ext-b $50 and ext-c $5000, the default replay gives one
    `items.price.range` row (`at: null`), and `--check` finds the live receipt byte-identical;
  - `--per-element` passes `{perElement: true}` (spy) and, with an evaluator that reports every
    element, writes rows `items[0].price`/0 and `items[2].price`/2.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 ("Checked 147 files").
- `with-lock suite pnpm test`: 31 files; 184 passed, 1 skipped.

## Blocked / for other streams

- **Real-evaluator per-element row count is blocked on VOCAB.** VOCAB's `EvalOptions.perElement`
  is not on main, and main's `evaluate()` ignores a third argument. The real-evaluator test
  ("exactly two items.price.range rows at items[0] and items[2]") is therefore
  `test.skipIf(!EVALUATOR_HAS_PER_ELEMENT)`. That check probes the evaluator itself, so the test
  runs as soon as VOCAB merges. MON passes options as `evaluate(contract, input, opts)`, matching
  VOCAB's `evaluate(contract, input, opts: EvalOptions = {})`.
- DET: a paper `CallRecord` with no probe replays `readAfterWrite` as *violated* ("no get_order
  probe ran"), not as *unverifiable*. That is the evaluator's behaviour today. PLAN N7 says DET
  asserts *unverifiable* offline, which needs either the evaluator (VOCAB) or DET's
  record/compare rule to handle it.
- CORE: `ProxyOptions.now` already exists; CORE threads `Domain.frozenClock` into it.
