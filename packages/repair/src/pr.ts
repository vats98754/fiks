import type { GateResult, ReproSpec, Trace } from '@fiks/repro';

export interface PrInput {
  trace: Trace;
  spec: ReproSpec;
  gates: GateResult[];
  diffStat: string;
  diff: string;
  agentSummary: string;
  runner: string;
  model: string;
  rerecorded: string[];
  repoUrl: string;
  branch: string;
}

/**
 * Local absolute paths (worktrees, home dirs, tmp, node_modules) never go into a public PR.
 * A path into the repo keeps its repo-relative tail (src/, test/, vendor/); anything else
 * becomes <local path>. URLs are left alone.
 */
export const scrubPaths = (s: string) =>
  s.replace(/(?<![\w:/.])(?:file:\/\/)?\/(?:Users|home|private|var|tmp|opt|root)\/[^\s)'"`]*/g, (p) => {
    const m = /\/((?:src|test|vendor)\/[^\s)'"`]*)$/.exec(p.replace(/.*\/node_modules\/.*/, ''));
    return m?.[1] ?? '<local path>';
  });

const fence = (s: string, lang = '') => `\`\`\`${lang}\n${s.trim()}\n\`\`\``;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);

export function prTitle(trace: Trace, spec: ReproSpec): string {
  return `fix(${trace.tool}): ${spec.propertyIds.map((p) => p.split('/')[1]).join(', ')} violated on vendor API ${trace.vendorVersionHeader ?? 'change'} (fiks)`;
}

export function prBody(p: PrInput): string {
  const t = p.trace;
  const target = new Set(p.spec.propertyIds);
  const gate = (g: GateResult['gate']) => p.gates.find((x) => x.gate === g);
  const f = gate('F');
  const local = gate('local');
  const ci = gate('ci');
  const firstFailure = scrubPaths(f?.evidence.failed[0]?.message.split('\n').slice(0, 6).join('\n') ?? '');
  const pGate = gate('P');
  const others =
    (f?.evidence.failed.length ?? 0) === 1
      ? 'pass (only the repro test failed in the F gate run)'
      : 'see F gate';
  return `## What broke
\`${t.tool}(${JSON.stringify(t.args)})\` returned a well-formed result that violates its outcome contract. No error was raised; the agent would have used the wrong data.

${t.violated
  .filter((v) => target.has(v.propertyId))
  .map((v) => `- \`${v.propertyId}\`: ${v.message}`)
  .join('\n')}

Captured by fiks-proxy at ${t.capturedAt} against vendor API \`${t.vendorVersionHeader ?? 'unknown'}\`. The vendor's OpenAPI spec did not change.

## Trace
\`${p.spec.tracePath}\` holds the exact call, the raw upstream HTTP and the violation:

${t.http.map((e) => `- \`${e.request.method} ${e.request.url}\` → ${e.response.status}`).join('\n')}${t.probe ? `\n- read-back \`${t.probe.tool}(${JSON.stringify(t.probe.args)})\`: ${t.probe.http.map((e) => `\`${e.request.method} ${e.request.url}\` → ${e.response.status}`).join(', ')}` : ''}

## Reproduction test
\`${p.spec.testPath}\` replays the trace. It fails on the base branch for the stated reason (${f?.reason ?? 'n/a'}):

${fence(firstFailure)}

## Fix
${scrubPaths(p.agentSummary.trim())}

${fence(p.diffStat)}

<details><summary>Diff (src/ only)</summary>

${fence(clip(p.diff, 12000), 'diff')}

</details>
${p.rerecorded.length ? `\nThe fix changes which upstream requests are sent, so fiks re-recorded these calls against the same vendor version (separate commit, \`*.rerecorded.json\` only):\n${p.rerecorded.map((r) => `- \`${r}\``).join('\n')}\n` : ''}
## Before / after
| | Base branch | This branch |
|---|---|---|
| Repro test | fails: ${f?.evidence.failed.length ?? 0} failing test, names ${[...target].map((x) => `\`${x}\``).join(', ')} | ${pGate?.ok ? 'passes' : 'FAILS'}: ${pGate?.reason ?? 'not run'} |
| Contract suite, stored traces, typecheck, lint | ${others} | ${local?.ok ? 'pass' : 'FAIL'}: ${local?.reason ?? 'not run'} |
| CI | — | [${ci?.ok ? 'success' : (ci?.reason ?? 'not run')}](${ci?.evidence.url ?? `${p.repoUrl}/actions`}) |

## Gates
${p.gates.map((g) => `- ${g.ok ? '✅' : '❌'} **${g.gate}**: ${g.reason}`).join('\n')}

A green suite shows the repro and every recorded contract pass; it is not a proof that the fix is correct. Please review before merging. Fiks never merges.

---
Opened by fiks. Repair agent: ${p.runner} (${p.model}).
`;
}
