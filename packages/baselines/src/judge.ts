// B-JUDGE / B-JUDGE+U (PLAN 6.1): an LLM judge without / with the raw upstream body, emulating
// LLM-scan products from their docs [altk-silent-review] [langsmith-engine-docs]. The model call
// goes through an injected `llm` (LLMR's `complete`: Agent SDK `query`, `tools: []`), so this
// module never talks to a model itself. Prompts live in packages/baselines/prompts/ and their
// sha256 values are recorded in prompts/HASHES.json; every result carries the prompt hash.
import { readFileSync } from 'node:fs';
import type { Verdict, Violation } from '@fiks/contracts';
import type { MonitorInput } from '@fiks/interfaces';
import type { BaselineMonitor, BaselineResult, LlmFn, LlmTokens } from './types.ts';
import { sha256Hex } from './util.ts';

export type JudgeVariant = 'B-JUDGE' | 'B-JUDGE+U';

export const PROMPT_VERSION = 'v1';
const PROMPT_DIR = new URL('../prompts/', import.meta.url);
export const PROMPT_FILES = {
  'B-JUDGE': `judge.${PROMPT_VERSION}.md`,
  'B-JUDGE+U': `judge-upstream.${PROMPT_VERSION}.md`,
  call: `call.${PROMPT_VERSION}.md`,
} as const;

/** Per-exchange cap on the upstream body shown to B-JUDGE+U. */
export const UPSTREAM_BODY_CAP = 8000;

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['verified', 'violated', 'unverifiable'] },
    property: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['verdict', 'property', 'confidence'],
  additionalProperties: false,
} as const;

const readPrompt = (file: string) => readFileSync(new URL(file, PROMPT_DIR), 'utf8');
/** The template without its leading `<!-- ... -->` provenance comment. */
const body = (text: string) => text.replace(/^<!--[\s\S]*?-->\s*\n/, '').trim();

/** sha256 of every prompt file, as recorded in prompts/HASHES.json. */
export function promptHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of Object.values(PROMPT_FILES).sort()) out[file] = sha256Hex(readPrompt(file));
  return out;
}

/** One hash naming a variant's prompt pair (system + call template). */
export function variantPromptHash(variant: JudgeVariant): string {
  const h = promptHashes();
  return sha256Hex(`${h[PROMPT_FILES[variant]]}\n${h[PROMPT_FILES.call]}`);
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function renderUpstream(input: MonitorInput): string {
  const xs = input.upstream ?? [];
  if (xs.length === 0) return '\nUpstream HTTP exchanges: none recorded';
  const parts = xs.map((x, i) => {
    const b = x.response.body;
    const shown =
      b.length > UPSTREAM_BODY_CAP
        ? `${b.slice(0, UPSTREAM_BODY_CAP)}\n[... ${b.length - UPSTREAM_BODY_CAP} more bytes]`
        : b;
    return `#${i + 1} ${x.request.method} ${x.request.url}${x.request.body ? `\nrequest body: ${x.request.body}` : ''}\n-> ${x.response.status}\n${shown}`;
  });
  return `\nUpstream HTTP exchanges:\n${parts.join('\n\n')}`;
}

/** The exact (system, prompt) pair sent for one call. */
export function renderJudgePrompt(
  variant: JudgeVariant,
  input: MonitorInput,
): { system: string; prompt: string } {
  const fill: Record<string, string> = {
    tool: input.tool,
    description: input.toolDef?.description ?? '(none)',
    outputSchema: input.toolDef?.outputSchema ? JSON.stringify(input.toolDef.outputSchema) : '(none)',
    args: json(input.args ?? {}),
    result: json(input.result),
    upstream: variant === 'B-JUDGE+U' ? renderUpstream(input) : '',
  };
  const prompt = body(readPrompt(PROMPT_FILES.call)).replace(
    /\{\{(\w+)\}\}/g,
    (_, k: string) => fill[k] ?? '',
  );
  return { system: body(readPrompt(PROMPT_FILES[variant])), prompt: prompt.trimEnd() };
}

export interface ParsedJudge {
  verdict: Verdict;
  property: string | null;
  confidence: number | null;
}

const VERDICTS = new Set(['verified', 'violated', 'unverifiable']);

/** Parses the judge's answer; null if it is not a valid {verdict, property, confidence} object. */
export function parseJudge(text: string): ParsedJudge | null {
  const t = text.replace(/```(?:json)?/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let o: unknown;
  try {
    o = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (o === null || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.verdict !== 'string' || !VERDICTS.has(r.verdict)) return null;
  const property = typeof r.property === 'string' && r.property.trim() ? r.property.trim() : null;
  const c = r.confidence;
  const confidence = typeof c === 'number' && c >= 0 && c <= 1 ? c : null;
  return { verdict: r.verdict as Verdict, property, confidence };
}

export interface JudgeResult extends BaselineResult {
  parsed: boolean;
  promptHash: string;
  model: string;
  tokenDetail: LlmTokens;
  raw: string;
}

const totalTokens = (t: LlmTokens) => t.in + t.out + (t.cacheRead ?? 0) + (t.cacheCreate ?? 0);

export interface JudgeMonitorOptions {
  variant: JudgeVariant;
  model: string;
  llm: LlmFn;
}

/** B-JUDGE / B-JUDGE+U monitor; an unparseable answer is `unverifiable` with `parsed: false`. */
export function createJudgeMonitor(opts: JudgeMonitorOptions): BaselineMonitor & { promptHash: string } {
  const promptHash = variantPromptHash(opts.variant);
  const id = `${opts.variant}:${opts.model}`;
  const monitor = async (input: MonitorInput): Promise<JudgeResult> => {
    const { system, prompt } = renderJudgePrompt(opts.variant, input);
    const res = await opts.llm({ model: opts.model, system, prompt, schema: JUDGE_SCHEMA });
    const p = parseJudge(res.text);
    const base = {
      promptHash,
      model: opts.model,
      tokenDetail: res.tokens,
      tokens: totalTokens(res.tokens),
      costUsd: res.costUsd,
      raw: res.text,
      disabled: [],
    };
    if (!p)
      return {
        ...base,
        verdict: 'unverifiable',
        checked: [],
        violations: [],
        parsed: false,
        confidence: null,
      };
    const violations: Violation[] =
      p.verdict === 'violated'
        ? [
            {
              propertyId: `${opts.variant}/${p.property ?? 'unspecified'}`,
              kind: 'judge',
              path: '$',
              expected: 'judge: result correct',
              actual: p.confidence,
              message: `${opts.variant} (${opts.model}) judged the result wrong: ${p.property ?? 'unspecified'}`,
            },
          ]
        : [];
    return {
      ...base,
      verdict: p.verdict,
      checked: [opts.variant],
      violations,
      parsed: true,
      confidence: p.confidence,
    };
  };
  return Object.assign(monitor, { id, promptHash });
}
