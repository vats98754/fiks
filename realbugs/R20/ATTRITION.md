# R20 attrition (Figma-Context-MCP #364)

**Status: reproduced; not attrited.** The reserve R14 was therefore not attempted (and its
licence question, FSL-1.1, did not need an answer).

| Check (PLAN 5.10) | Result |
|---|---|
| F on the prefix `b97585c` (10 runs) | 10/10 violate `figma.download_figma_images/fileWritten`, 1 distinct verdict, clean replay (`paper/build-logs/RB-R20.md`) |
| P on the human fix `eaeec68` (10 runs) | 10/10 verified, clean replay, no contract fire |
| Duplicate / already fixed (step 7) | #364 is closed by #367 (merged 2026-04-25); no other open issue was found for the same symptom in the candidate search (`paper/research/real-bugs-mcp.md`). The prefix is the fix's only parent, so the bug is present at the prefix and absent at the fix. |
| Sandboxed (step 8) | the server is built and run only in the SBX per-repo image (`--network none`, read-only root, `HOME=/tmp`); nothing from the clone runs on the host |

## Fidelity limits (to report with E7)

- **Platform.** The reporter ran Windows 11 with a Windows absolute path. The replay runs on Linux
  with the equivalent absolute POSIX path inside the project; the reporter states Unix-style paths
  fail the same way, and the mechanism (an absolute `localPath` re-rooted under the image
  directory by `path.join`) is platform-independent. The reporter's literal drive-letter path on a
  POSIX server does not manifest under the contract (held-out H8: it is not absolute on POSIX).
- **Synthesized upstream.** No exchange was recorded: the reporter's Figma file is private and no
  Figma token is used. The Figma REST responses and image bytes are synthesized in the shapes of
  the endpoints the server calls, and every fixture is labelled `synthesized` in `adapter.json`.
  The bug does not depend on upstream content (it is in local path resolution), so this does not
  change the F/P outcome.
- **Contamination stratum (step 9).** Upstream is a public, popular repository; the issue (opened
  2026-04-24) and fix (merged 2026-04-25) are public, and may predate a model's training cutoff.
  Treat R20 as *possibly contaminated* in the E7 report.
- **Hint in the PR title.** The fix PR title ("reject ambiguous localPath inputs") was read before
  the blind contract (it is part of the candidate metadata); see `contract-log.md`.
- **Suite scope.** Three upstream test files are outside `suiteScope` because they cannot run in
  the offline sandbox within their own timeouts or need a real token (`adapter.json` notes).
