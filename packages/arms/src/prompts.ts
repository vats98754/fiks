// Prompts of the comparator arms (PLAN 6.2, 5.5). The task and rules follow the FIKS product
// prompt (packages/repair/src/prompt.ts) so arms differ only in what PLAN 6.2 says they differ in:
// the evidence (alert + trace file + helper sentence | alert prose | issue text), whether a repro
// comes first, and how the change is checked. L1, L1-noIV and L1p share one "how it is checked"
// text (the trigger check stays hidden until it fails); COMP, COMP-norep, COMP-plain and ISSUE-TEXT
// share another.
import type { Domain, TraceFormat } from '@fiks/interfaces';
import { renderStrictTrace, sanitizeGateOutput, strictTrace } from '@fiks/repair';
import { type AlertPayload, renderAlert, reproLoadingSentence } from './alert.ts';
import type { ArmSpec } from './arms.ts';
import { BUDGET } from './budget.ts';
import type { FrozenTraceFile } from './trace.ts';

export interface IssueText {
  title: string;
  body: string;
}

export interface PromptInput {
  spec: ArmSpec;
  domain: Pick<Domain, 'id' | 'promptHints'>;
  /** The rendered evidence (absent for ISSUE-TEXT). */
  alert?: AlertPayload;
  /** The frozen trace (strict mode renders it typed instead of pointing at the raw file). */
  trace?: FrozenTraceFile;
  issue?: IssueText;
  traceFormat?: TraceFormat;
  /** L1 family: output of the failed checks of the previous session. */
  previousFailure?: string;
  /** COMP family: the red CI log of the previous revision. */
  redCiLog?: string;
}

export const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s;

/** The last `n` characters (a CI log's failure is at its end). */
export const tail = (s: string, n: number) =>
  s.length > n ? `... (${s.length - n} earlier characters)\n${s.slice(-n)}` : s;

const serverName = (d: PromptInput['domain']) =>
  typeof d.promptHints.server === 'string' ? d.promptHints.server : `the ${d.id} MCP server`;

function evidenceBlock(p: PromptInput): string {
  if (!p.alert) throw new Error(`${p.spec.name} needs an alert`);
  if (p.traceFormat === 'strict' && p.alert.trace && p.trace) {
    // E6 strict: the raw file is quarantined; the typed trace stands in for it in the prompt.
    const { trace: _path, ...rest } = p.alert;
    const prose = sanitizeGateOutput(renderAlert(rest), { traceFormat: 'strict' });
    const typed = renderStrictTrace(strictTrace({ ...p.trace, target: p.alert.target }));
    return `${prose}\n\nTyped trace of the recorded call (strict format; vendor text is not shown, the raw file is not readable in this run):\n${typed}`;
  }
  return renderAlert(p.alert);
}

function rules(p: PromptInput, opts: { newTests: boolean; alerts: boolean }): string {
  const hints = p.domain.promptHints.repair ?? [];
  const readOnly = [
    'existing tests',
    'fixtures',
    'recorded traces',
    ...(opts.alerts ? ['the files under .alerts/'] : []),
  ];
  return `## Useful files
${hints.map((h) => `- ${h}`).join('\n')}

## Rules
- Change only the server's source files under src/.${opts.newTests ? ' You may add new test files under test/.' : ''} ${readOnly.join(', ').replace(/, ([^,]*)$/, ' and $1')} are read-only. Do not edit vendored files, CI, package.json or the lockfile.
- Fix the root cause so the tool returns correct data. Do not return an error instead of data, do not invent or cache values, and do not hide the problem.
- Keep the base vendor version working: the v1 fixtures must keep producing exactly the same output.
- If your fix changes which HTTP requests the tool sends (a new header, extra pages), that is fine: your own test runs may then report UNMATCHED_REQUEST for recordings that lack those requests. Every check that gates or grades your change first re-records such recordings against the same upstream. Do not edit recordings.
- Check your work with: pnpm typecheck, pnpm lint, pnpm test (or pnpm test <path>, pnpm exec vitest run <path>). Only these pnpm commands are allowed.
- Keep the change small and in the style of the surrounding code.`;
}

const REPLY = `When you are done, reply in exactly this form:
Subject: <an imperative commit subject, at most 60 characters>
<one short paragraph: the root cause and the fix>`;

const GATED_CHECKS = `## How your change is checked
When you finish, your change is checked before a pull request is opened. If a check fails, you get its output and a new session to fix it (at most ${BUDGET.maxSessions} sessions in total).`;

const POST_PR_CHECKS = `## How your change is checked
A pull request is opened as soon as you finish with a change. CI then runs on it; if CI fails, you get its log and may revise the change (at most ${BUDGET.maxRevisions} revisions).`;

function feedback(p: PromptInput): string {
  const fmt = p.traceFormat ?? 'raw';
  if (p.previousFailure)
    return `\n## Your previous session's change did not pass the checks\n${sanitizeGateOutput(tail(p.previousFailure, 4000), { traceFormat: fmt })}\nYour earlier changes are still in the working tree. Fix this and try again.\n`;
  if (p.redCiLog)
    return `\n## CI failed on your pull request\n${sanitizeGateOutput(tail(p.redCiLog, 4000), { traceFormat: fmt })}\nYour change is still in the working tree. Revise it so CI passes.\n`;
  return '';
}

/** The repair prompt of an L1-family or COMP-family arm (incl. ISSUE-TEXT). */
export function repairPrompt(p: PromptInput): string {
  const server = serverName(p.domain);
  const { spec } = p;
  if (spec.family === 'repro') throw new Error('REPRO-AGENT has its own prompt (reproPrompt)');
  const intro = `You are fixing a bug in ${server}, an MCP server that wraps a vendor HTTP API.`;
  const checks = spec.family === 'gated' ? GATED_CHECKS : POST_PR_CHECKS;
  if (spec.evidence === 'issue') {
    if (!p.issue) throw new Error('ISSUE-TEXT needs the issue text (--issue)');
    return `${intro} A user reported this issue:

## ${p.issue.title.trim()}
${p.issue.body.trim()}

${rules(p, { newTests: true, alerts: false })}

${checks}
${feedback(p)}
${REPLY}`;
  }
  const what =
    spec.family === 'post-pr'
      ? 'Reproduce the issue first, then fix it.'
      : 'Fix the issue described by this alert.';
  return `${intro} A runtime monitor caught the tool returning wrong data to an agent:

## Alert
${evidenceBlock(p)}

## Task
${what}

${rules(p, { newTests: true, alerts: spec.evidence === 'trace' })}

${checks}
${feedback(p)}
${REPLY}`;
}

/** REPRO-AGENT (PLAN 5.5): write one failing test, no fix. */
export function reproPrompt(p: PromptInput): string {
  if (!p.alert) throw new Error('REPRO-AGENT needs an alert');
  const server = serverName(p.domain);
  const hints = p.domain.promptHints.repair ?? [];
  return `You are reproducing a bug in ${server}, an MCP server that wraps a vendor HTTP API. A runtime monitor caught the tool returning wrong data to an agent:

## Alert
${evidenceBlock(p)}

## Task
Write one new test file under test/ that reproduces the issue on the current code: it must fail on the current code because of the reported problem. Do not fix the code and do not change any existing file.
${reproLoadingSentence(p.alert.id)}
Run it with pnpm test <path> or pnpm exec vitest run <path>; only these pnpm commands (and pnpm typecheck, pnpm lint) are allowed.

## Useful files
${hints.map((h) => `- ${h}`).join('\n')}
- test/fiks/: the replay helper (replay.ts) and the wrappers that run a recorded call through the current code and check its contract (run.ts, check.ts).

When you are done, reply with the path of your test file and one sentence on what it asserts.`;
}

/** REPRO-AGENT's fixed F feedback (PLAN 5.5): the first 40 lines of the runner output. */
export function fFeedback(runnerOutput: string): string {
  const first40 = runnerOutput.split('\n').slice(0, 40).join('\n');
  return `Your test does not fail on the current code because of the reported issue: ${first40}. Revise it so it fails on the current code.`;
}
