import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContract } from '@fiks/contracts';
import type { GateResult, ReproSpec, Trace } from '@fiks/repro';

export interface PromptInput {
  trace: Trace;
  spec: ReproSpec;
  contract: ToolContract;
  gateF: GateResult;
  worktree: string;
  /** Output of a failed previous attempt, if any. */
  previousFailure?: string;
}

const clip = (s: string, n = 1500) =>
  s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s;

/** The v1 baseline fixture for the same tool and arguments, when one exists. */
function baseline(worktree: string, trace: Trace): string | undefined {
  try {
    const dir = join(worktree, 'test/fixtures/v1');
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.rerecorded.json')) continue;
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (rec.tool === trace.tool && JSON.stringify(rec.args) === JSON.stringify(trace.args)) {
        return `test/fixtures/v1/${f}`;
      }
    }
  } catch {}
  return undefined;
}

export function buildPrompt(p: PromptInput): string {
  const t = p.trace;
  const target = new Set(p.spec.propertyIds);
  const violations = t.violated.filter((v) => target.has(v.propertyId));
  const exchanges = t.http
    .map(
      (e) =>
        `${e.request.method} ${e.request.url} -> ${e.response.status}\n  vendor-api-version: ${e.response.headers['vendor-api-version'] ?? '-'}\n  ${clip(e.response.body, 800)}`,
    )
    .join('\n');
  const probe = t.probe
    ? `\nRead-back probe ${t.probe.tool}(${JSON.stringify(t.probe.args)}):\n${t.probe.http.map((e) => `${e.request.method} ${e.request.url} -> ${e.response.status}`).join('\n')}`
    : '';
  const failure = p.gateF.evidence.failed[0]?.message ?? '';
  const base = baseline(p.worktree, t);
  return `You are fixing a bug in shop-mcp, an MCP server that wraps a vendor HTTP API. The vendor changed its behavior without changing its published spec, and shop-mcp now returns wrong data to agents without any error.

## What broke (captured from real traffic)
Tool call: ${t.tool}(${JSON.stringify(t.args)})
Violated contract properties:
${violations.map((v) => `- ${v.propertyId}: ${v.message}`).join('\n')}

Upstream HTTP during that call (recorded):
${exchanges}${probe}

## The failing reproduction test
${p.spec.testPath} replays that exact call against the recording and fails:
${clip(failure, 1200)}

## The contract for ${t.tool}
${JSON.stringify(p.contract, null, 2)}

## Useful files
- src/tools/*.ts: one file per tool. src/vendor.ts: the HTTP client.
- vendor/openapi.json: the vendor's published spec (it did not change).
- ${base ? `${base}: a recording of the same call against the previous vendor version (2026-01-01), which shop-mcp still has to support.` : 'test/fixtures/v1/*.json: recordings against the previous vendor version (2026-01-01), which shop-mcp still has to support.'}
- Responses carry a vendor-api-version header (2026-01-01 before the change, 2026-10-01 after).

## Rules
- Change only files under src/. Do not edit tests, fixtures, traces, vendored files, CI, package.json or the lockfile.
- Fix the root cause so the tool returns correct data. Do not return an error instead of data, do not invent or cache values, and do not hide the problem.
- Keep the old vendor version working: the v1 fixtures must keep producing exactly the same output.
- If your fix changes which HTTP requests the tool sends (a new header, extra pages), that is fine: the repro test will then report UNMATCHED_REQUEST because the recording lacks those requests, and fiks will re-record the call against the live vendor after you finish. Make sure everything else passes.
- Check your work with: pnpm typecheck, pnpm lint, pnpm test. Only these pnpm commands are allowed.
- Keep the change small and in the style of the surrounding code.
${p.previousFailure ? `\n## Your previous attempt failed the gate\n${clip(p.previousFailure, 2000)}\nFix this and try again.\n` : ''}
When you are done, reply in exactly this form:
Subject: <an imperative commit subject, at most 60 characters, e.g. "read unit_amount when price is missing">
<one short paragraph: the root cause and the fix>`;
}
