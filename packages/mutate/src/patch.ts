// Patch-mutation operators P1-P8 (paper/PLAN.md 5.4, 5.6): committed prompts in ../prompts plus a
// deterministic wrapper around an injected `llm` function. The wrapper renders the prompt, makes
// exactly one llm call, and turns the reply into a normalized diff (see catalog.json patchFrame).
// It never retries and never calls a model itself: the caller (LLMR's route) owns retries and cost.
import { readFileSync } from 'node:fs';
import catalog from '../catalog.json' with { type: 'json' };
import { DiffError, diffFiles, extractDiff, normalizeDiff, parseDiff } from './diff.ts';
import { sha256 } from './util.ts';

export const PATCH_OPS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] as const;
export type PatchOp = (typeof PATCH_OPS)[number];
export const isPatchOp = (op: string): op is PatchOp => (PATCH_OPS as readonly string[]).includes(op);

/** One model call: system prompt + user prompt in, reply text out. Injected by the caller. */
export type PatchLlm = (req: { op: PatchOp; system: string; prompt: string }) => Promise<string>;

export interface MutatePatchOptions {
  /**
   * BASE sources (path -> content) of the files the reference diff touches, plus any other file the
   * operator may edit. With them the reply is located and applied in memory (`verified`); without
   * them only the hunk counts are repaired.
   */
  baseFiles?: Record<string, string>;
  /** Free text for the prompt's Context section: the drift, the recorded call, the contract. */
  context?: string;
  /** Paths the reply may edit. Default: the reference diff's files, plus every key of baseFiles. */
  allowedPaths?: string[];
}

export interface PatchMutation {
  op: PatchOp;
  name: string;
  /** False when the reply was not a usable diff; `error` says why and `diff` is ''. */
  ok: boolean;
  error?: string;
  /** Normalized unified diff against BASE. */
  diff: string;
  files: string[];
  /** Applied in memory to `baseFiles`. */
  verified: boolean;
  /** The normalized diff equals the normalized reference diff. */
  identicalToReference: boolean;
  /** New file contents (when verified). */
  result?: Record<string, string>;
  promptSha256: string;
  replySha256: string;
  diffSha256: string | null;
  /** The rendered prompts and the raw reply, for the run record. */
  system: string;
  prompt: string;
  reply: string;
}

const PKG = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, PKG), 'utf8');

const entry = (op: PatchOp) => {
  const e = catalog.patch.find((p) => p.id === op);
  if (!e) throw new Error(`catalog.json has no entry for ${op}`);
  return e;
};

const fence = (path: string, content: string) => {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '';
  return `### ${path}\n\n\`\`\`${ext}\n${content}${content.endsWith('\n') ? '' : '\n'}\`\`\``;
};

/** Single-pass `{{NAME}}` substitution, so substituted text is never re-scanned. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m));
}

/** The exact system and user prompts mutatePatch sends for (op, refFixDiff, opts). */
export function renderPatchPrompt(
  op: PatchOp,
  refFixDiff: string,
  opts: MutatePatchOptions = {},
): { system: string; prompt: string } {
  if (!isPatchOp(op)) throw new Error(`unknown patch operator ${JSON.stringify(op)}`);
  const e = entry(op);
  const allowed = allowedPaths(refFixDiff, opts);
  const base = opts.baseFiles ?? {};
  const sources = Object.keys(base)
    .sort()
    .map((p) => fence(p, base[p] as string));
  const prompt = fill(read(catalog.patchFrame.user), {
    OPERATOR_ID: op,
    OPERATOR_NAME: e.name,
    OPERATOR_INSTRUCTION: read(e.prompt).trim(),
    CONTEXT: opts.context?.trim() || '(none given)',
    REFERENCE_DIFF: refFixDiff.replace(/\n$/, ''),
    FILES: allowed.map((p) => `- ${p}`).join('\n'),
    BASE_SOURCES: sources.length
      ? sources.join('\n\n')
      : '(not provided; use the reference fix context lines)',
  });
  return { system: read(catalog.patchFrame.system).trim(), prompt };
}

function allowedPaths(refFixDiff: string, opts: MutatePatchOptions): string[] {
  if (opts.allowedPaths) return [...new Set(opts.allowedPaths)].sort();
  return [...new Set([...diffFiles(refFixDiff), ...Object.keys(opts.baseFiles ?? {})])].sort();
}

/** Normalized form of a diff (for dedupe and the reference comparison). */
export function normalizePatch(diff: string, baseFiles?: Record<string, string>): string {
  return normalizeDiff(parseDiff(diff), baseFiles).diff;
}

/**
 * Applies patch operator `op` to the reference fix `refFixDiff`: one `llm` call with the committed
 * prompt, then the deterministic reply wrapper. A reply that is not a usable diff gives ok = false
 * (a pool candidate that failed), never a throw; errors from `llm` itself propagate (infra errors).
 */
export async function mutatePatch(
  op: PatchOp,
  refFixDiff: string,
  llm: PatchLlm,
  opts: MutatePatchOptions = {},
): Promise<PatchMutation> {
  const { system, prompt } = renderPatchPrompt(op, refFixDiff, opts);
  const reply = await llm({ op, system, prompt });
  if (typeof reply !== 'string') throw new Error(`llm returned ${typeof reply}, not a string`);
  const base: Omit<PatchMutation, 'ok' | 'diff' | 'files' | 'verified' | 'identicalToReference'> = {
    op,
    name: entry(op).name,
    promptSha256: sha256(`${system}\n\n${prompt}`),
    replySha256: sha256(reply),
    diffSha256: null,
    system,
    prompt,
    reply,
  };
  const failed = (error: string): PatchMutation => ({
    ...base,
    ok: false,
    error,
    diff: '',
    files: [],
    verified: false,
    identicalToReference: false,
  });
  try {
    const parsed = parseDiff(extractDiff(reply));
    const allowed = new Set(allowedPaths(refFixDiff, opts));
    const outside = parsed.map((f) => f.path).filter((p) => !allowed.has(p));
    if (outside.length) return failed(`edits files outside the allowed set: ${outside.join(', ')}`);
    const n = normalizeDiff(parsed, opts.baseFiles);
    let reference: string | null = null;
    try {
      reference = normalizePatch(refFixDiff, opts.baseFiles);
    } catch {
      reference = null;
    }
    const out: PatchMutation = {
      ...base,
      ok: true,
      diff: n.diff,
      files: n.files,
      verified: n.verified,
      identicalToReference: reference === n.diff,
      diffSha256: sha256(n.diff),
    };
    if (n.result) out.result = n.result;
    return out;
  } catch (e) {
    if (e instanceof DiffError) return failed(e.message);
    throw e;
  }
}
