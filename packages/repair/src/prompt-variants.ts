// Repair prompt variants for the exploratory input ablation (paper/EXP-PLAN.md, E-A). The product
// prompt (`buildPrompt`, prompt.ts) is not changed; these are separate builders.
//
//  - NOHINT: `buildPrompt` minus exactly the four items EXP-PLAN lists: the failure-class sentence,
//    the v1-recording path, the vendor-version-header note and the "a new header, extra pages"
//    note. Contract, trace and repro test stay. Built by removing those exact spans from the
//    product prompt, so any later change to `buildPrompt` either flows through unchanged or makes
//    this builder throw (a span no longer found) instead of silently drifting.
//  - ALERT: a prose alert (the receipt text an agent would see, the violated properties and the
//    raw trace), with no repro test and no mention of one, and no contract. Its generic sections
//    (useful files, rules, reply format) are NOHINT's, minus the repro-test sentences, so the arms
//    nest: ALERT's inputs are a subset of NOHINT's, which are a subset of FIKS's.
import type { Trace } from '@fiks/repro';
import { buildPrompt, type PromptInput } from './prompt.ts';

/** The four NOHINT omissions, in prompt order. */
export const NOHINT_OMISSIONS = [
  'failure-class sentence',
  'v1-recording path',
  'vendor-version-header note',
  'new-header-extra-pages note',
] as const;
export type NoHintOmission = (typeof NOHINT_OMISSIONS)[number];

/** The exact text of each omission (a regex over the product prompt). */
const OMISSION_PATTERNS: Record<NoHintOmission, RegExp> = {
  // First paragraph, second sentence (the leading space goes with it).
  'failure-class sentence':
    / The vendor changed its behavior without changing its published spec, and shop-mcp now returns wrong data to agents without any error\./,
  // The "Useful files" line naming the v1 recording of the same call (present only when one exists).
  'v1-recording path':
    /- test\/fixtures\/v1\/[^\n:]+\.json: a recording of the same call against the previous vendor version \(2026-01-01\), which shop-mcp still has to support\.\n/,
  'vendor-version-header note':
    /- Responses carry a vendor-api-version header \(2026-01-01 before the change, 2026-10-01 after\)\.\n/,
  'new-header-extra-pages note':
    /- If your fix changes which HTTP requests the tool sends \(a new header, extra pages\), that is fine: the repro test will then report UNMATCHED_REQUEST because the recording lacks those requests, and fiks will re-record the call against the live vendor after you finish\. Make sure everything else passes\.\n/,
};

export interface NoHintResult {
  prompt: string;
  /** The exact spans removed from the product prompt, by omission. */
  removed: Partial<Record<NoHintOmission, string>>;
}

/**
 * NOHINT prompt with the removed spans. Throws when a span that must be present is missing (the
 * product prompt changed); the v1-recording path is optional (the product prompt names it only
 * when a v1 recording of the same call exists, else a generic fixtures line, which stays).
 */
export function noHintPromptWithOmissions(p: PromptInput): NoHintResult {
  if (p.traceFormat === 'strict') throw new Error('buildNoHintPrompt: only the raw trace format');
  let prompt = buildPrompt(p);
  const removed: NoHintResult['removed'] = {};
  for (const name of NOHINT_OMISSIONS) {
    const re = OMISSION_PATTERNS[name];
    const all = prompt.match(new RegExp(re.source, 'g')) ?? [];
    if (all.length > 1) throw new Error(`buildNoHintPrompt: "${name}" appears ${all.length} times`);
    const m = all[0];
    if (m === undefined) {
      if (name === 'v1-recording path') continue;
      throw new Error(`buildNoHintPrompt: "${name}" not found in the product prompt`);
    }
    removed[name] = m;
    prompt = prompt.replace(m, '');
  }
  return { prompt, removed };
}

/** `buildPrompt` minus exactly the four EXP-PLAN NOHINT items. */
export function buildNoHintPrompt(p: PromptInput): string {
  return noHintPromptWithOmissions(p).prompt;
}

const clip = (s: string, n = 1500) =>
  s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s;

/** The upstream exchanges exactly as `buildPrompt` renders them (headers, 800-character bodies). */
export function renderExchanges(t: Trace): string {
  const exchanges = t.http
    .map(
      (e) =>
        `${e.request.method} ${e.request.url} -> ${e.response.status}\n  vendor-api-version: ${e.response.headers['vendor-api-version'] ?? '-'}\n  ${clip(e.response.body, 800)}`,
    )
    .join('\n');
  const probe = t.probe
    ? `\nRead-back probe ${t.probe.tool}(${JSON.stringify(t.probe.args)}):\n${t.probe.http.map((e) => `${e.request.method} ${e.request.url} -> ${e.response.status}`).join('\n')}`
    : '';
  return `${exchanges}${probe}`;
}

export interface AlertPromptInput {
  trace: Trace;
  /**
   * The receipt line the calling agent saw (the proxy's `receiptText` for this violated call).
   * Passed in: @fiks/repair does not depend on the proxy.
   */
  receiptText: string;
  /** Target properties (default: the trace's target, else every violated property). */
  propertyIds?: string[];
}

/** ALERT prompt: receipt text + violated properties + raw trace. No repro test, no contract. */
export function buildAlertPrompt(p: AlertPromptInput): string {
  const t = p.trace;
  const target = new Set(p.propertyIds ?? t.target ?? t.violated.map((v) => v.propertyId));
  const violations = t.violated.filter((v) => target.has(v.propertyId));
  const returned = t.result?.structuredContent ?? t.result?.content ?? null;
  return `You are fixing a bug in shop-mcp, an MCP server that wraps a vendor HTTP API.

## Alert from production monitoring
A monitor in front of shop-mcp flagged this tool call. The agent that made the call was told:
${p.receiptText}

Tool call: ${t.tool}(${JSON.stringify(t.args)})
Violated properties:
${violations.map((v) => `- ${v.propertyId}: ${v.message}`).join('\n')}

What shop-mcp returned:
${clip(JSON.stringify(returned), 1200)}

Upstream HTTP during that call (recorded):
${renderExchanges(t)}

## Useful files
- src/tools/*.ts: one file per tool. src/vendor.ts: the HTTP client.
- vendor/openapi.json: the vendor's published spec (it did not change).

## Rules
- Change only files under src/. Do not edit tests, fixtures, traces, vendored files, CI, package.json or the lockfile.
- Fix the root cause so the tool returns correct data. Do not return an error instead of data, do not invent or cache values, and do not hide the problem.
- Keep the old vendor version working: the v1 fixtures must keep producing exactly the same output.
- Check your work with: pnpm typecheck, pnpm lint, pnpm test. Only these pnpm commands are allowed.
- Keep the change small and in the style of the surrounding code.

When you are done, reply in exactly this form:
Subject: <an imperative commit subject, at most 60 characters, e.g. "read unit_amount when price is missing">
<one short paragraph: the root cause and the fix>`;
}
