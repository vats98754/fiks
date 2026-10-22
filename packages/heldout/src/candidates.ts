// Primary-pool candidate generation (PLAN 5.6): P1-P8 applied to ref A through MUT's committed
// prompts (mutatePatch, Haiku), >= 4 plausible-but-wrong patches (Haiku) and >= 2 alternative fixes
// (Sonnet) written from the drift description and the base source without seeing ref A or B (the
// prompts in ../prompts). The model call is injected (LLMR's complete() in runs, a stub in tests).
// Every candidate must apply to the base and typecheck in the grading container (5.4); the ones
// that do not are dropped and counted.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  baseFilesAt,
  extractDiff,
  mutatePatch,
  normalizeDiff,
  PATCH_OPS,
  type PatchOp,
  parseDiff,
} from '@fiks/mutate';
import { sha256 } from './hash.ts';
import { prepareHead } from './head.ts';
import type { LoadedPackage } from './pkg.ts';
import type { PoolCandidate, PoolSource } from './pool.ts';
import { run, type SandboxFactory } from './sandbox.ts';

export type CandidateKind = PatchOp | 'plausible-wrong' | 'alternative';

export interface CandidateRequest {
  kind: CandidateKind;
  model: string;
  system: string;
  prompt: string;
  /** 1-based sample index for repeated kinds. */
  sample: number;
}

/** One model call: prompt in, reply text out. */
export type CandidateLlm = (req: CandidateRequest) => Promise<string>;

export interface GenerationLog {
  id: string;
  kind: CandidateKind;
  model: string;
  promptSha256: string;
  replySha256: string;
  ok: boolean;
  error?: string;
}

export const DEFAULT_MODELS = {
  mutation: 'claude-haiku-5-5',
  plausibleWrong: 'claude-haiku-5-5',
  alternative: 'claude-sonnet-5-5',
};

const PROMPTS = new URL('../prompts/', import.meta.url);
const prompt = (name: string) => readFileSync(new URL(name, PROMPTS), 'utf8');

const fill = (t: string, vars: Record<string, string>) =>
  t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m));

const fence = (path: string, content: string) =>
  `### ${path}\n\n\`\`\`ts\n${content}${content.endsWith('\n') ? '' : '\n'}\`\`\``;

/** Every `src/**` source file of the base (what an alternative fixer sees). */
export function baseSources(repoDir: string, commit: string): Record<string, string> {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, 'src'], {
    cwd: repoDir,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((p) => /\.[cm]?tsx?$/.test(p));
  return Object.fromEntries(
    files.map((p) => [
      p,
      execFileSync('git', ['show', `${commit}:${p}`], { cwd: repoDir, encoding: 'utf8' }),
    ]),
  );
}

export interface GenerateOptions {
  repoDir: string;
  llm: CandidateLlm;
  /** What changed upstream, in words (the drift description; never ref A or B). */
  description: string;
  plausibleWrong?: number;
  alternatives?: number;
  models?: Partial<typeof DEFAULT_MODELS>;
}

/** Candidates (diffs against the base) and a log line per model call. */
export async function generateCandidates(
  p: LoadedPackage,
  opts: GenerateOptions,
): Promise<{ candidates: PoolCandidate[]; log: GenerationLog[] }> {
  const models = { ...DEFAULT_MODELS, ...opts.models };
  const commit = execFileSync('git', ['rev-parse', '--verify', `${p.pkg.base}^{commit}`], {
    cwd: opts.repoDir,
    encoding: 'utf8',
  }).trim();
  const refA = readFileSync(p.refA, 'utf8');
  const refB = readFileSync(p.refB, 'utf8');
  const candidates: PoolCandidate[] = [
    { id: `${p.pkg.id}/refA`, source: 'refA', generator: 'drift-author', diff: refA },
    { id: `${p.pkg.id}/refB`, source: 'refB', generator: 'independent-fixer', diff: refB },
  ];
  const log: GenerationLog[] = [];
  const baseFiles = baseFilesAt(opts.repoDir, commit, refA);
  for (const op of PATCH_OPS) {
    const m = await mutatePatch(
      op,
      refA,
      (r) => opts.llm({ kind: op, model: models.mutation, sample: 1, ...r }),
      {
        baseFiles,
        context: opts.description,
      },
    );
    const id = `${p.pkg.id}/${op}`;
    log.push({
      id,
      kind: op,
      model: models.mutation,
      promptSha256: m.promptSha256,
      replySha256: m.replySha256,
      ok: m.ok,
      ...(m.error ? { error: m.error } : {}),
    });
    if (m.ok) candidates.push({ id, source: op as PoolSource, generator: models.mutation, diff: m.diff });
  }
  const all = baseSources(opts.repoDir, commit);
  const files = Object.entries(all)
    .map(([path, text]) => fence(path, text))
    .join('\n\n');
  const kinds: [CandidateKind, number, string, string][] = [
    ['plausible-wrong', opts.plausibleWrong ?? 4, models.plausibleWrong, 'plausible-wrong.md'],
    ['alternative', opts.alternatives ?? 2, models.alternative, 'alternative.md'],
  ];
  const system = prompt('system.md');
  for (const [kind, count, model, file] of kinds) {
    for (let sample = 1; sample <= count; sample++) {
      const text = fill(prompt(file), {
        DESCRIPTION: opts.description,
        REF_DIFF: kind === 'plausible-wrong' ? refA.trimEnd() : '',
        FILES: files,
        SAMPLE: String(sample),
        COUNT: String(count),
      });
      const reply = await opts.llm({ kind, model, system, prompt: text, sample });
      const id = `${p.pkg.id}/${kind}-${sample}`;
      const entry: GenerationLog = {
        id,
        kind,
        model,
        promptSha256: sha256(`${system}\n\n${text}`),
        replySha256: sha256(reply),
        ok: false,
      };
      try {
        const n = normalizeDiff(parseDiff(extractDiff(reply)), all);
        entry.ok = true;
        candidates.push({ id, source: kind, generator: model, diff: n.diff });
      } catch (e) {
        entry.error = (e as Error).message;
      }
      log.push(entry);
    }
  }
  return { candidates, log };
}

/** Keeps the candidates that apply to the base and typecheck in the grading container (PLAN 5.4). */
export async function typecheckCandidates(
  p: LoadedPackage,
  candidates: readonly PoolCandidate[],
  env: { repoDir: string; sandbox: SandboxFactory },
): Promise<{ kept: PoolCandidate[]; dropped: { id: string; why: string }[] }> {
  const kept: PoolCandidate[] = [];
  const dropped: { id: string; why: string }[] = [];
  for (const c of candidates) {
    const head = prepareHead(env.repoDir, p.pkg.base, c.diff);
    try {
      if (!head.applied) {
        dropped.push({ id: c.id, why: `does not apply: ${head.error ?? ''}`.slice(0, 300) });
        continue;
      }
      const sb = await env.sandbox(head.dir, []);
      try {
        const r = await run(sb, 'pnpm', ['run', '--silent', 'typecheck'], { timeoutMs: 10 * 60_000 });
        if (r.code === 0) kept.push(c);
        else dropped.push({ id: c.id, why: `typecheck: ${`${r.stdout}${r.stderr}`.slice(-300)}` });
      } finally {
        await sb.cleanup();
      }
    } finally {
      head.remove();
    }
  }
  return { kept, dropped };
}
