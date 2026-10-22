import { execFileSync } from 'node:child_process';
import type { RunKey } from '@fiks/interfaces';
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
  /** sha256 per artifact (trace, repro test, diff, ...), listed under Provenance. */
  hashes?: Record<string, string>;
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

## Provenance
The trace is untrusted input: its bodies came from the upstream API, not from fiks. Review the diff on its own merits, not the trace text.
${Object.entries(p.hashes ?? {})
  .map(([k, v]) => `- ${k}: \`sha256:${v}\``)
  .join('\n')}

A green suite shows the repro and every recorded contract pass; it is not a proof that the fix is correct. Please review before merging. Fiks never merges.

---
Opened by fiks. Repair agent: ${p.runner} (${p.model}).
`;
}

/** The only account fiks may open pull requests on (P5). */
export const PR_OWNER = 'vats98754';

export class PrRefusedError extends Error {
  constructor(reason: string) {
    super(`createPr refused: ${reason}`);
    this.name = 'PrRefusedError';
  }
}

export interface CreatePrOptions {
  /** `vats98754/<name>` or `<name>`; any other owner is refused. */
  repo: string;
  /** Head branch, optionally `vats98754:<branch>`. */
  head: string;
  base: string;
  title: string;
  bodyFile: string;
  labels?: string[];
  noPr?: boolean;
  /** Set in experiment mode (`--arm`): no PR unless `noPr: false` is passed explicitly. */
  arm?: string;
  /** Set in experiment mode (`--run-key`): never a PR, never a gh call. */
  runKey?: RunKey | string;
  /** argv runner for gh (default: `FIKS_GH` or `gh`). */
  gh?: (args: string[]) => string;
}

export type CreatePrResult =
  | { status: 'skipped'; reason: string }
  | { status: 'opened'; url: string; number: number; repo: string };

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9][\w./-]{0,200}$/;

interface RepoView {
  name?: string;
  owner?: { login?: string };
  isFork?: boolean;
  parent?: { name?: string; owner?: { login?: string } } | null;
}

/** Whether a run must not open a PR: experiment mode (run key: always; arm: by default). */
export function prDisabled(o: Pick<CreatePrOptions, 'noPr' | 'arm' | 'runKey'>): boolean {
  if (o.runKey !== undefined) return true;
  return o.noPr ?? o.arm !== undefined;
}

/**
 * Opens a PR, held to the owner allow-list on the BASE repository (P5). `--repo vats98754/<name>`
 * is always explicit; the repo is resolved with `gh repo view --json owner,isFork,parent` and
 * refused if its owner is not vats98754 or it is a fork of a repo outside vats98754 (where
 * `gh pr create` would default the base to the upstream). The head owner is checked too. With
 * `noPr`, a run key or an arm, nothing is invoked at all.
 */
export function createPr(o: CreatePrOptions): CreatePrResult {
  if (prDisabled(o)) {
    return {
      status: 'skipped',
      reason: o.runKey !== undefined ? 'experiment mode (--run-key): no PR' : 'no PR (--no-pr or --arm)',
    };
  }
  const run =
    o.gh ?? ((args: string[]) => execFileSync(process.env.FIKS_GH ?? 'gh', args, { encoding: 'utf8' }));
  const parts = o.repo.split('/');
  const [owner, name] = parts.length === 1 ? [PR_OWNER, parts[0]] : parts;
  if (parts.length > 2 || owner !== PR_OWNER)
    throw new PrRefusedError(`base repo ${o.repo} is not owned by ${PR_OWNER}`);
  if (!name || !REPO_NAME.test(name)) throw new PrRefusedError(`bad repo name ${JSON.stringify(name)}`);
  const repo = `${PR_OWNER}/${name}`;
  const headParts = o.head.split(':');
  if (headParts.length > 2) throw new PrRefusedError(`bad head ${o.head}`);
  const [headOwner, branch] = headParts.length === 2 ? headParts : [PR_OWNER, headParts[0]];
  if (headOwner !== PR_OWNER) throw new PrRefusedError(`head owner ${headOwner} is not ${PR_OWNER}`);
  if (!branch || !REF.test(branch)) throw new PrRefusedError(`bad head branch ${JSON.stringify(branch)}`);
  if (!REF.test(o.base)) throw new PrRefusedError(`bad base branch ${JSON.stringify(o.base)}`);
  for (const l of o.labels ?? []) {
    if (!/^[\w][\w .:/-]{0,49}$/.test(l)) throw new PrRefusedError(`bad label ${JSON.stringify(l)}`);
  }

  let view: RepoView;
  try {
    view = JSON.parse(run(['repo', 'view', repo, '--json', 'owner,isFork,parent'])) as RepoView;
  } catch (e) {
    throw new PrRefusedError(
      `could not resolve ${repo}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
    );
  }
  const resolvedOwner = view.owner?.login;
  if (resolvedOwner !== PR_OWNER) {
    throw new PrRefusedError(`base repo ${repo} resolves to owner ${resolvedOwner ?? 'unknown'}`);
  }
  if (typeof view.isFork !== 'boolean') throw new PrRefusedError(`gh repo view gave no isFork for ${repo}`);
  if (view.isFork) {
    const parentOwner = view.parent?.owner?.login;
    if (parentOwner !== PR_OWNER) {
      throw new PrRefusedError(
        `${repo} is a fork of ${parentOwner ?? 'an unknown owner'}/${view.parent?.name ?? '?'}; gh would default the base upstream`,
      );
    }
  }

  for (const label of o.labels ?? []) {
    try {
      run(['label', 'create', label, '--repo', repo, '--color', '0E8A16', '--description', 'Opened by fiks']);
    } catch {
      // already exists
    }
  }
  const url = run([
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    o.base,
    '--head',
    branch,
    '--title',
    o.title,
    '--body-file',
    o.bodyFile,
    ...(o.labels ?? []).flatMap((l) => ['--label', l]),
  ])
    .trim()
    .split('\n')
    .pop() as string;
  return { status: 'opened', url, number: Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0), repo };
}
