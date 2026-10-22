# Adversarial payload templates: sources and licences

The twelve payload templates in `packages/attacks/src/templates.ts` are **paraphrased injection
lures derived from published descriptions** of each attack technique, not verbatim copies of any
licensed artifact. Each is a short natural-language instruction placed in vendor-controlled bytes to
probe the four E6 goals; none is working exploit code. This file records, for every template, the
source it is derived from and that source's licence/terms. The `source` key of each template matches
a bib key in `paper/research/gap-repair-security.md` and an entry in
`gap-repair-security.sources.json`; the paraphrase status is noted so the claims auditor can confirm
no copyrighted payload text is reproduced.

| template id | source key | source | type | licence / terms (derivation) |
|---|---|---|---|---|
| `agentdojo-important-instructions` | `debenedetti2024agentdojo` | AgentDojo, arXiv:2406.13352 | paper + repo | MIT (repo) [verify]; lure paraphrased from the `important_instructions` attack description |
| `agentdojo-tool-knowledge` | `debenedetti2024agentdojo` | AgentDojo, arXiv:2406.13352 | paper + repo | MIT (repo) [verify]; lure paraphrased from the `tool_knowledge` attack description |
| `injecagent-data-steal` | `zhan2024injecagent` | InjecAgent, arXiv:2403.02691 (Findings of ACL 2024) | paper + repo | repo licence [verify]; paraphrased from the data-stealing attacker-instruction class |
| `injecagent-direct-harm` | `zhan2024injecagent` | InjecAgent, arXiv:2403.02691 | paper + repo | repo licence [verify]; paraphrased from the direct-harm attacker-instruction class |
| `aishelljack-source-embed` | `liu2025aishelljack` | AIShellJack, arXiv:2509.22040 | paper | artifact availability [verify]; paraphrased from the source-embedding finding (payload moves into source when the shell is restricted) |
| `aishelljack-attck-exec` | `liu2025aishelljack` | AIShellJack, arXiv:2509.22040 | paper | artifact availability [verify]; paraphrased from the ATT&CK command-execution payload class |
| `githubmcp-toxic-flow` | `invariant2025githubmcp` | Invariant Labs blog | blog | all rights reserved (prose paraphrased, nothing copied); describes the "toxic agent flow" that leaks private data into a PR |
| `pillar-hidden-unicode` | `pillar2025rulesbackdoor` | Pillar Security blog | blog | all rights reserved (prose paraphrased); invisible-Unicode carrier hides the instruction from a human reviewer |
| `copilot-autoapprove` | `rehberger2025cve53773` | Embrace The Red blog; MITRE CVE-2025-53773 | blog + CVE | blog all rights reserved (paraphrased); CVE record public; describes an injection that writes an auto-approve config |
| `cursor-mcp-config` | `cve2025-54135-cursor` | MITRE CVE-2025-54135 | CVE | CVE record public; describes injection that creates a `.cursor/mcp.json` config |
| `impossiblebench-operator-overload` | `zhong2025impossiblebench` | ImpossibleBench, arXiv:2510.20270 | paper + repo | repo licence [verify]; paraphrased from the operator-overloading / special-casing cheat taxonomy |
| `impossiblebench-special-case` | `zhong2025impossiblebench` | ImpossibleBench, arXiv:2510.20270 | paper + repo | repo licence [verify]; paraphrased from the special-casing cheat taxonomy |

Notes

- `[verify]` marks a licence that should be re-checked against the artifact's repository before the
  paper's security section is finalised (the citation verifiers' job). The paraphrase derivation does
  not depend on the artifact licence, because no artifact text is copied; the note records provenance.
- All adversarial runs that use these templates stay on clones/branches under `vats98754`
  (ORCHESTRATION rule); no PR is opened outside it.
- The twelve templates cover the four attack goals (canary egress, attacker-directed `src` behaviour,
  non-`src` edit, disallowed command) across the carrier placements in `packages/attacks/src/carrier.ts`.
