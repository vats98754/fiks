# R20 contract log (blind contract, PLAN 5.10 step 2)

Bug: GLips/Figma-Context-MCP #364, "`download_figma_images` returns success, but no file is
actually written to the local target". Human fix: PR #367, "fix: reject ambiguous localPath
inputs in download_figma_images", squash-merged as `eaeec68041584114acb23cda05b8838a5e204341`,
whose only parent is the prefix `b97585caf502f0e0b41cfd8f0a2f3f11559e1e77` (base branch `main`).

The contract was written from the symptom only. Inputs read before it was written: the issue
title and body (`gh issue view 364`), the candidate row in
`paper/research/real-bugs-mcp.candidates.json` (symptom, fault class, postcondition note), the
PR's metadata only (`gh pr view 367 --json number,title,state,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences`:
the title and the head branch name `fix/download-images-path-resolution` were therefore seen; no
body, no commits, no files, no diff), the merge commit's parents (`gh api .../commits/eaeec68`:
sha, parents, first message line, date), the prefix tree listing, `README.md`, `.env.example`,
`src/config.ts` (CLI flags and env: `--image-dir`/`IMAGE_DIR`, proxy, telemetry), the prefix
server's `--help` and its own `tools/list` (names, descriptions, input schemas). Not read before
the contract: `src/services/download-figma-images.ts`, `src/mcp/tools/download-figma-images-tool.ts`,
`src/services/figma.ts`, `src/utils/*`, the prefix tests, the fix PR body, its commits, its files
and its diff.

The PR title is a hint about the fix direction (localPath handling). It was seen before the
contract, as the title of a fix PR is part of the candidate row in R10 too; it is recorded here
as a contamination note, not hidden.

## Session log (UTC, from `date -u` in the session)

| Time | Step |
|---|---|
| 2026-10-22T12:10:03Z | Read issue #364 title + body (`gh issue view`). |
| 2026-10-22T12:10:09Z | PR #367 metadata only (number, title, merge commit, base/head branch names, closing issue). |
| 2026-10-22T12:10:23Z | Merge commit parents via `gh api .../commits/eaeec68` (sha, parents, first message line, date); repo licence (MIT). |
| 2026-10-22T12:10:30Z | Plain `git clone --no-checkout` of upstream into `.work/realbugs/R20`; both pinned SHAs present; prefix checked out. |
| 2026-10-22T12:10:40Z | Prefix tree listing, `.env.example`, `.nvmrc`; `README.md` (setup, flags). |
| 2026-10-22T12:11:54Z | SBX per-repo image built from the prefix lockfile (`packages/sandbox/src/build.ts`, digest `sha256:af0ec3eae4eb2b8a1aa2ba02c7029890416934403bd34c36abd32542118ea0fe`). |
| 2026-10-22T12:13:58Z | `src/config.ts` (flags/env only: `imageDir` defaults to the process cwd; HTTPS_PROXY via undici `EnvHttpProxyAgent`; `--no-telemetry`). |
| 2026-10-22T12:20:38Z–12:30:59Z | In the sandbox (`--network none`): `pnpm run build` of the prefix, `node dist/bin.js --help`, then `tools/list` over MCP stdio. |
| 2026-10-22T12:31:40Z | **Contract written**: `contract.json` sha256 `b50b1fa3644d66924a79b45b013c2605249314bc5476ac6ff3d633e240419f61`. |

Every later step (reading the prefix implementation, the first read of the fix diff, fixtures,
harness) is logged below the contract section, after this timestamp.

## The contract and why

Symptom (issue): `download_figma_images` answers "Success, 1 images downloaded" (case 1: a
bitmap node with an `imageRef`) or "Success, 1 images downloaded: <localPath>/<fileName>"
(case 2: a vector node exported as SVG), yet the `localPath` directory stays empty and the file
is nowhere in the project. The reporter passed an absolute `localPath` inside the project
(`C:\Users\xl\Desktop\figma\public\figma-assets\retry-final`) and says Unix-style paths behave
the same. The tool description (prefix `tools/list`) says images are saved "relative to the
server's image directory: <dir>" and that `localPath` is "relative to the project root".

Property `figma.download_figma_images/fileWritten` (kind `fileWrittenRequested`): after a
non-error result, for every requested node `n`, let `D` = `args.localPath` when it is absolute,
else `<imageDir>/<args.localPath>`; the file `D/<n.fileName>` must be a regular file of at least
one byte (with `n.filenameSuffix` set, any file in `D` whose name contains the suffix and ends
with the requested extension counts). Every file path the response reports (absolute, or
relative to `imageDir`) must also be a regular file of at least one byte. A node the response
visibly reports as not downloaded is exempt. Violated otherwise.

Choices made blind, before seeing any implementation or the fix:

- **Where the file must be.** An absolute `localPath` means that directory: an agent that asks
  for `/abs/dir` and gets "Success" will look there. A relative `localPath` resolves against the
  image directory the tool description announces, which is the only base the agent is told.
  A server that writes an absolute request somewhere else (e.g. under the image directory) and
  still reports success violates the property, even if it names that other place.
- **Either fix direction passes.** Writing the file where asked verifies; refusing the input with
  an explicit `isError` result is unverifiable (the agent sees the failure), so it is not a
  contract fire. The property does not prefer one.
- **Signal.** A response that names the node's `fileName` or `nodeId` in a text block that also
  says it failed / was skipped / could not be written exempts that node. A response that only
  gives a count ("0 of 2 downloaded") without naming the file does not; that would be a
  documented false positive, not tuned away.
- **Size ≥ 1 byte** (the candidate row's postcondition "file exists with non-zero size"). The
  content itself is not compared (no oracle for image bytes in the symptom).
- **Reported paths.** Case 2 shows the response echoing a path that does not exist; every
  reported path must therefore exist too.

Trigger chosen from the issue before any code was read: image directory = the project root
`/tmp/r20/project` (the server process's cwd, the default), `localPath` = the absolute
`/tmp/r20/project/public/figma-assets/retry-final` (inside the project, as in the issue), two
nodes as in the issue's two cases: a bitmap node with an `imageRef`
(`retry-bitmap-162-4324.png`) and a vector node (`retry-vector-162-4334.svg`), `fileKey`
`3QAuo1d9LT32Cxju6o7xDt`.

## Vocabulary gap (C11)

The fiks vocabulary has no filesystem postcondition: its read-after-write probes call another
tool of the same server and compare values with the result. Here the write's effect is a file on
the caller's disk and the server has no tool that reads it back. The property is therefore a new
args-driven kind (`fileWrittenRequested`), evaluated by `harness/check.ts` over a filesystem
listing taken after the call, with the same property id form (`<contract id>/<name>`) and the
same `Violation`/`EvalResult` shapes as `@fiks/contracts`. This is a real limit of the frozen
vocabulary for this bug class (a side effect outside the server's own API), recorded for the
paper's limitations, not a change to `@fiks/contracts`.

## After the contract (contract.json was not edited after 12:31:40Z)

| Time (UTC) | Step |
|---|---|
| 2026-10-22T12:32:16Z | Contract committed on `ws/RB-R20` (`28484c1`, "blind contract ... before reading the fix diff"). |
| 2026-10-22T12:32:21Z | Read the prefix implementation (`download-figma-images-tool.ts`, `services/download-figma-images.ts`, `services/figma.ts`, `utils/common.ts`, `utils/image-processing.ts`, `utils/fetch-json.ts`, `server.ts` proxy setup, telemetry opt-out). |
| 2026-10-22T12:32:50Z | **First read of the fix diff** (`git diff --stat` and `git diff` prefix..fix of `src/`). |
| 2026-10-22T12:34:54Z | Private repo `vats98754/rb-r20-figma-context-mcp` created (`gh repo create --private`, not a fork); pushed `main` = prefix and tag `r20-fix` = fix. Clone recreated from it by `node scripts/ensure-realbugs.mjs --id R20` (origin = the private repo only; local tags `prefix`, `fix`). |
| 2026-10-22T12:39:18Z–12:43:06Z | `harness/run.ts --runs 1`: prefix violated (both nodes), fix verified. |
| ~12:45Z–12:48Z (no exact stamp taken) | `heldout/run.ts`: prefix 2/8 ok (incorrect), fix 8/8 ok (correct). |

What the human fix does (read after the contract): the prefix resolved `localPath` with
`path.join(imageDir, localPath)` on purpose ("a leading `/` is treated as relative"), so an
absolute `localPath` inside the project was re-rooted under the image directory
(`/tmp/r20/project` + `/tmp/r20/project/public/...` = `/tmp/r20/project/tmp/r20/project/public/...`):
the files were written, just not where the caller asked, and the reply said "Downloaded 2
images" with bare file names. The fix adds `src/utils/local-path.ts` (`resolveLocalPath`,
`isWithin`): absolute paths are accepted when they resolve inside the image directory and written
there; absolute paths elsewhere, leading-slash paths outside it and Windows drive letters on POSIX
are refused with `isError` and a hint; the success text now echoes the resolved directory; stdio
mode warns when `--image-dir` is unset.

So the blind contract's two directions both occur in the fix: the trigger (absolute, inside the
project) verifies because the files land where asked; held-out cases H2, H3 and H8 are refused
(`isError`, unverifiable, no fire).

### One interpretation fixed while implementing check.ts (after the fix diff was read)

The rule says "every file path the response reports (absolute, or relative to imageDir)". In
`check.ts` a *path* is a token that contains a separator (`/` or `\`) and ends in `.png`, `.svg`
or `.gif`; a bare file name such as `- retry-bitmap-162-4324.png: 8x6` is a name, not a path.
This was decided between 12:32:50Z (first read of the fix diff) and 12:39:18Z (first harness
run), i.e. after the fix diff was read, and is recorded as such. Effect: under the literal alternative (bare names resolved against imageDir) the property
would fire on every successful reply of both heads, including correct writes to a relative
`localPath`, because both list bare names; the F result on the prefix does not depend on the
choice (the per-node clause fires on both nodes either way). The issue's own example of a
reported path (case 2) contains separators.

### Results with this contract

- Trigger, prefix: violated on both nodes (`args.nodes[0]`, `args.nodes[1]`), the files exist at
  `/tmp/r20/project/tmp/r20/project/public/figma-assets/retry-final/`. Fix: verified.
- Held-out: the contract fires exactly on the six cases the held-out oracle fails on the prefix
  (H1–H3, H5–H7); on the fix it never fires (5 verified, 3 unverifiable = refused). No false
  positive observed. Known false-positive class kept from the blind choices: a correct server that
  reports a failed node only by count would fire.
