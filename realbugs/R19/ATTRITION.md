# R19 attrition record

**Outcome: reproduced. Not attrited, so the reserve (servers #4628, `vats98754/rb-r19r-servers`) was not attempted and that repository was not created.**

- Bug: mongodb-js/mongodb-mcp-server PR #561 ("fix: incorrect number of clusters found"). Tool: `atlas-list-clusters` with a `projectId`.
- Prefix `62a57d815107d6cfb9ec9a436b82abe376ca10f1`. Human fix `7fa4a2f21865ac0bcd824bfb0875b0523afecfe2`, a squash merge whose single parent is the prefix.
- Private plain clone: `vats98754/rb-r19-mongodb-mcp-server`. `main` is at the prefix and tag `human-fix` is at the fix. It is not a fork.

## F and P (PLAN 5.10 step 5)

Run as `pnpm tsx realbugs/R19/harness/run.ts --sha prefix|fix --runs 10`:

- **Prefix:** 10/10 runs violate `mongodb.atlas-list-clusters/count.matchesRows`. The tool says "Found 170 clusters" but lists 2. The 170 is the length of the joined row string.
- **Fix:** 10/10 runs are verified, with no contract fire and no unmatched upstream request.
- **Held-out set** (`--heldout`, 1, 5 and 12 clusters): every fixture fails on the prefix and verifies on the fix.

## Caveats that stop short of attrition

1. **Fixtures are synthesized, not recorded.**
   - There is no Atlas account. Recording from cloud.mongodb.com would also be a third-party action, and none is approved.
   - The upstream bodies follow the prefix's Atlas Admin API v2 schemas (`src/common/atlas/openapi.d.ts`). Every fixture is labelled `synthesized`.
   - The trigger's `result`, `violated` and `target` come from a replay of the prefix (`harness/stamp-trigger.ts`).
2. **The replay runs over plain HTTP.**
   - The server's fetch (`@mongodb-js/devtools-proxy-support`) trusts only the bundled and system CAs, not `NODE_EXTRA_CA_CERTS`. So the RBX HTTPS replay with a throwaway CA fails with "unable to get local issuer certificate".
   - Over HTTP, oauth4webapi refuses the client-credentials token request before sending it (HTTPS only). As a result, the API requests carry no `Authorization` header and the fixtures hold no token exchange.
   - The bug is in result formatting, so the auth path does not affect it.
3. **The human-fix test cannot run offline.**
   - `tests/integration/tools/atlas/clusters.test.ts` needs live Atlas credentials (`describeWithAtlas` skips without them).
   - It is listed in `humanFixTests` and `suiteScope`, but offline it is skipped on both prefix and fix, so it does not tell them apart.
   - The prefix and fix are told apart by the contract replay and `heldout/` (`heldoutCommand`).
4. **`suiteScope` leaves one file out, and it is not checked in an SBX repo image.**
   - `suiteScope` is the offline unit tests plus the eslint-rules test, without `tests/unit/common/exportsManager.test.ts`. That file is timing-flaky: it failed in 2 of 4 offline runs (once in a full-scope run and once in 3 isolated runs), on a different test each time.
   - SBX `build.ts` supports only pnpm repositories ("only pnpm repos are supported"), and this repo uses npm (`package-lock.json`). So instead the scope was checked in the SBX base image (`node:22.23.3-bookworm-slim@sha256:3ed98443…`) with Linux `npm ci --ignore-scripts` and `--network none`. Prefix and fix each gave 19 files passed and 1 skipped (the human-fix test), 283 tests passed, in 3 of 3 runs.
   - RBA needs an npm-capable repo image for this bug. That is a gap in SBX, not in R19.

## Duplicates and already-fixed check (step 7)

- The bug is present at the prefix: F reproduces.
- No other upstream issue or PR reports it. The PR has no linked issue, and a search of the repository's issues for "clusters" on 2026-10-22 found nothing for this bug.
- The fix touches only `src/tools/atlas/read/listClusters.ts` and the live-Atlas test.

## Contamination stratum (step 9)

**Pre-cutoff public fix.** The fix was merged publicly on 2025-09-16, before the knowledge cutoff of the models under test. Report R19 in the contaminated stratum.
