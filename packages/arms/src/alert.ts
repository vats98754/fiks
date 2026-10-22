// The alert every comparator arm receives (PLAN 6.2 "Alert payload"): a webhook-style JSON built
// from the frozen trace, rendered to prose by one renderer, identical across arms. The JSON bytes
// are the same for L1, L1-noIV, COMP, COMP-norep, COMP-plain and REPRO-AGENT; L1p's lacks only
// the trace path (with its sha256) and the replay-helper sentence. The trace itself is given as
// `.alerts/<id>.json`, a byte copy of the frozen trace (sha256 equal), read-only to the agent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeReceipt, receiptText } from '@fiks/proxy';
import type { LoadedTrace } from './trace.ts';

/** The one sentence naming the repo's replay helper (PLAN 3.0 "Evidence"). */
export const REPLAY_HELPER_SENTENCE =
  "The repository's `test/fiks/replay.ts` replays a recorded upstream exchange like this one against the server.";

/** REPRO-AGENT's fixed loading sentence (PLAN 5.5); `<id>` is the trace id. */
export const reproLoadingSentence = (id: string) =>
  `Load the recorded exchange from \`.alerts/${id}.json\` with the repository's replay helper (\`test/fiks/replay.ts\`, or \`test/fiks/run.ts\`/\`check.ts\`, which wrap it); do not copy it into the test.`;

export const alertRelPath = (id: string) => `.alerts/${id}.json`;

export interface AlertPayload {
  kind: 'fiks.alert';
  v: 1;
  id: string;
  capturedAt: string;
  tool: string;
  args: Record<string, unknown>;
  contractId: string | null;
  /** The full receipt list: property id and message of every violated property. */
  violated: { propertyId: string; message: string }[];
  /** The property the alert is about (the frozen trace's target). */
  target: string[];
  /** The receipt text the agent using the tool saw. */
  receipt: string;
  /** The recorded call: path in the repository (read-only) and its sha256 (= the frozen trace). */
  trace?: { path: string; sha256: string };
  replayHelper?: string;
}

export interface AlertOptions {
  /** L1p: the alert in prose only, without the trace path and the helper sentence. */
  proseOnly?: boolean;
}

export function buildAlert(t: LoadedTrace, opts: AlertOptions = {}): AlertPayload {
  const tr = t.trace;
  const violated = tr.violated ?? [];
  const receipt = makeReceipt(
    { verdict: 'violated', contractId: tr.contractId ?? null, checked: [], violations: violated },
    new Date(tr.capturedAt),
    true,
    tr.id,
  );
  const payload: AlertPayload = {
    kind: 'fiks.alert',
    v: 1,
    id: tr.id,
    capturedAt: tr.capturedAt,
    tool: tr.tool,
    args: tr.args,
    contractId: tr.contractId ?? null,
    violated: violated.map((v) => ({ propertyId: v.propertyId, message: v.message })),
    target: tr.target ?? violated.map((v) => v.propertyId),
    receipt: receiptText(receipt, tr.tool),
  };
  if (opts.proseOnly) return payload;
  return {
    ...payload,
    trace: { path: alertRelPath(tr.id), sha256: t.sha256 },
    replayHelper: REPLAY_HELPER_SENTENCE,
  };
}

/** The alert's JSON bytes (what "byte-identical across arms" compares). */
export const alertJson = (a: AlertPayload) => `${JSON.stringify(a, null, 2)}\n`;

/** Webhook JSON -> prose. One renderer for every arm; the only input is the payload. */
export function renderAlert(a: AlertPayload): string {
  const lines = [
    `fiks alert ${a.id} (${a.capturedAt}): the tool ${a.tool} returned data that violates its contract${a.contractId ? ` ${a.contractId}` : ''}, without any error.`,
    `Tool call: ${a.tool}(${JSON.stringify(a.args)})`,
    'Violated properties:',
    ...a.violated.map((v) => `- ${v.propertyId}: ${v.message}`),
    `The alert is about: ${a.target.join(', ')}`,
    `Receipt the agent saw: ${a.receipt}`,
  ];
  if (a.trace)
    lines.push(
      `The recorded call (tool, arguments, raw upstream requests and responses) is in ${a.trace.path} (read-only; sha256 ${a.trace.sha256}).`,
    );
  if (a.replayHelper) lines.push(a.replayHelper);
  return lines.join('\n');
}

/** Writes `.alerts/<id>.json` = the frozen trace's bytes into the worktree. */
export function writeAlertTrace(worktree: string, t: LoadedTrace): string {
  const file = join(worktree, alertRelPath(t.trace.id));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, t.bytes);
  return file;
}
