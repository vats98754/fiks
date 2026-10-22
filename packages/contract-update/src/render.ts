// Renders an accepted delta as a contract-change proposal: the rationale, the gate evidence and
// a unified diff of the changed contracts. It never contains code, and never a code path: the
// only file it names is the contracts JSON.
import type { ContractFile, ToolContract } from '@fiks/contracts';
import type { GateResult } from './gate.ts';
import { parseDelta } from './outcome.ts';

export interface ProposalOptions {
  /** Repo-relative path of the contracts file (default `contracts/<server>.contracts.json`). */
  contractsPath?: string;
}

export interface ContractProposal {
  /** Markdown proposal for a human reviewer. */
  markdown: string;
  /** Unified diff of the changed contracts (each pretty-printed on its own). */
  diff: string;
  /** The full contract file after the delta. */
  proposed: ContractFile;
}

type Op = { kind: ' ' | '-' | '+'; line: string };

/** Line diff by longest common subsequence. Inputs are a few hundred lines at most. */
function lineDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // lcs[i * w + j] = length of the LCS of a[i..] and b[j..].
  const lcs = new Uint32Array((n + 1) * w);
  const L = (i: number, j: number) => lcs[i * w + j] ?? 0;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] = a[i] === b[j] ? L(i + 1, j + 1) + 1 : Math.max(L(i + 1, j), L(i, j + 1));
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: ' ', line: a[i] ?? '' });
      i++;
      j++;
    } else if (j >= m || (i < n && L(i + 1, j) >= L(i, j + 1))) out.push({ kind: '-', line: a[i++] ?? '' });
    else out.push({ kind: '+', line: b[j++] ?? '' });
  }
  return out;
}

/** Unified-diff hunks with `context` lines around each change. */
function hunks(ops: Op[], context = 3): string[] {
  const out: string[] = [];
  const changed = ops.flatMap((o, k) => (o.kind !== ' ' ? [k] : []));
  // Group changes whose context windows touch into one hunk: [first, last] op indices.
  const groups: [number, number][] = [];
  for (const k of changed) {
    const g = groups.at(-1);
    if (g && k - context <= g[1] + context + 1) g[1] = k;
    else groups.push([k, k]);
  }
  for (const [first, last] of groups) {
    const start = Math.max(0, first - context);
    const end = Math.min(ops.length - 1, last + context);
    let aStart = 1;
    let bStart = 1;
    for (const o of ops.slice(0, start)) {
      if (o.kind !== '+') aStart++;
      if (o.kind !== '-') bStart++;
    }
    const body = ops.slice(start, end + 1);
    const aLen = body.filter((o) => o.kind !== '+').length;
    const bLen = body.filter((o) => o.kind !== '-').length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of body) out.push(`${o.kind}${o.line}`);
  }
  return out;
}

function pretty(c: ToolContract | undefined): string[] {
  return c ? JSON.stringify(c, null, 2).split('\n') : [];
}

/** Unified diff of every contract that differs between `base` and `proposed`. */
export function contractDiff(base: ContractFile, proposed: ContractFile, contractsPath: string): string {
  const ids = [...new Set([...base.contracts, ...proposed.contracts].map((c) => c.id))];
  const parts: string[] = [];
  for (const id of ids) {
    const a = pretty(base.contracts.find((c) => c.id === id));
    const b = pretty(proposed.contracts.find((c) => c.id === id));
    const h = hunks(lineDiff(a, b));
    if (!h.length) continue;
    parts.push(`--- a/${contractsPath} (contract ${id})`, `+++ b/${contractsPath} (contract ${id})`, ...h);
  }
  return parts.length ? `${parts.join('\n')}\n` : '';
}

/**
 * Free text as an inert markdown blockquote: each line trimmed (an indented line would become a
 * code block) and every character that can open code or markup escaped (` ~ < > \ &), so the text
 * renders as plain prose whatever it contains.
 */
export function plainText(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) =>
      l
        .trim()
        .replace(/[\\`~<>]/g, (ch) => `\\${ch}`)
        .replace(/&/g, '&amp;'),
    )
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
}

/** One line of trace-derived text (notes quote call arguments) with code and markup escaped. */
function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\\`~<>]/g, (ch) => `\\${ch}`)
    .replace(/&/g, '&amp;');
}

/** A fence longer than any backtick run in `body`, so the body cannot close it. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export function renderProposal(
  base: ContractFile,
  result: GateResult,
  opts: ProposalOptions = {},
): ContractProposal {
  if (!result.accepted || !result.proposed || !result.delta)
    throw new Error('renderProposal: only an accepted contract update becomes a proposal');
  const contractsPath = opts.contractsPath ?? `contracts/${base.server}.contracts.json`;
  if (!/\.contracts\.json$/.test(contractsPath))
    throw new Error(
      `renderProposal: ${contractsPath} is not a contracts file; a proposal never touches code`,
    );
  // The gate parsed the delta already; re-check, since a GateResult can be built by hand and the
  // rationale is the one free-text field that reaches the markdown.
  const again = parseDelta(result.delta);
  if (!again.ok)
    throw new Error(`renderProposal: the delta is not a valid contract update: ${again.errors.join('; ')}`);
  const diff = contractDiff(base, result.proposed, contractsPath);
  const fence = fenceFor(diff);
  const s = result.summary;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(', ') : 'none');
  const lines = [
    '# Contract update proposal',
    '',
    'The observed behaviour is treated as legitimate: this proposes a change to the outcome contract.',
    'It changes no code and opens no pull request; a maintainer decides whether to adopt it.',
    '',
    '## Rationale',
    '',
    'As stated by the repair agent (plain text, not verified by the gate):',
    '',
    plainText(again.value.rationale),
    '',
    '## What changes',
    '',
    `- Amended properties: ${list(result.amended)}`,
    `- Added properties: ${list(result.added)}`,
    `- Contract-level changes (known-good inputs): ${list(result.contractLevel)}`,
    '',
    '## Gate evidence (deterministic, offline)',
    '',
    `- Trigger: ${s.trigger.before} under the current contract, ${s.trigger.after} under the proposal.`,
    `- Stored true-violation traces: ${s.stored.stillViolate} of ${s.stored.used} still violate their target properties (${s.stored.total} given).`,
    `- Clean v1 corpus: ${s.corpus.total} cases (${s.corpus.verified} verified before), ${s.corpus.regressions} new violations.`,
    `- Mutation variants of the trigger: ${s.mutation.rejectedBefore} of ${s.mutation.total} rejected before, ${s.mutation.rejectedAfter} after; none lost on a property the proposal does not amend.`,
    ...(result.notes.length ? ['', '### Notes', '', ...result.notes.map((n) => `- ${escapeInline(n)}`)] : []),
    '',
    '## Contract diff',
    '',
    `${fence}diff`,
    diff.trimEnd(),
    fence,
    '',
  ];
  return { markdown: lines.join('\n'), diff, proposed: result.proposed };
}
