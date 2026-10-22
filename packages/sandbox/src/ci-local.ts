// Hermetic local CI (PLAN P4, P21): the `run:` steps of the target repo's workflow, in order, inside
// the repo's sandbox image with --network none, plus optional extra checks (issue validation: post-PR
// for COMP via ciLocal, pre-PR for L1 via runPreGate, with the same check commands).
//
// Mirroring rules: `uses:` steps (checkout, pnpm/node setup) are what the image already is, so they
// are listed as provided by the image and not run; each `run:` step runs as
// `bash --noprofile --norc -eo pipefail -c <script>` at the worktree root (GitHub's default run
// shell, so `cmd | tee f` fails when cmd fails); `pnpm install` gets `--offline` (the store is in the
// image, and there is no network). The first failing CI step skips the remaining CI steps, as in
// Actions. Extra checks always run, so their verdict is known even when CI is red. A workflow construct
// that is not mirrored (step if/env/shell/working-directory/continue-on-error, job matrix/env/defaults,
// `${{ }}` expressions, ...) makes parseWorkflow throw instead of giving a verdict Actions may not share.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecBackend } from '@fiks/interfaces';
import { DockerExecBackend, type DockerExecBackendOptions } from './backend.ts';

export interface WorkflowStep {
  job: string;
  name: string;
  /** Shell script of a `run:` step; undefined for a `uses:` step. */
  run?: string;
  uses?: string;
  /** Step-level `timeout-minutes:`, mirrored as that step's timeout. */
  timeoutMinutes?: number;
}

/** Thrown when a workflow uses something ciLocal does not mirror, so it cannot silently disagree with Actions. */
export class UnmirroredWorkflowError extends Error {
  override name = 'UnmirroredWorkflowError';
}

/** Step keys ciLocal mirrors. Anything else (`if`, `env`, `working-directory`, `shell`, `continue-on-error`, ...) throws. */
const STEP_KEYS = new Set(['name', 'run', 'uses', 'with', 'id', 'timeout-minutes']);
/**
 * Job keys ciLocal mirrors or that cannot change a verdict (jobs run in file order, serially). Anything
 * else (`strategy`/`matrix`, `env`, `defaults`, `if`, `container`, `services`, `continue-on-error`, a
 * reusable-workflow `uses`, ...) throws.
 */
const JOB_KEYS = new Set([
  'name',
  'runs-on',
  'timeout-minutes',
  'needs',
  'permissions',
  'concurrency',
  'outputs',
  'steps',
]);
/** Workflow-level keys that change how every `run:` step behaves. */
const UNMIRRORED_TOP_KEYS = new Set(['env', 'defaults']);

const indentOf = (line: string) => line.length - line.trimStart().length;
const unquote = (s: string) => {
  const t = s.trim();
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))
    ? t.slice(1, -1)
    : t;
};
const keyOf = (line: string) => /^\s*(?:- )?([\w-]+|'[^']*'|"[^"]*"):(?:\s|$)/.exec(line)?.[1];
const isComment = (line: string) => !line.trim() || line.trimStart().startsWith('#');

/**
 * The steps of every job in a GitHub Actions workflow, in file order. Supports what CI files in
 * this project use: `- name:`, `- uses:` (+ `with:`), `run:` as a plain scalar or a `|`/`>` block,
 * step `timeout-minutes:`. Throws UnmirroredWorkflowError on any construct whose effect ciLocal does not
 * reproduce (step `if`/`env`/`working-directory`/`shell`/`continue-on-error`, job `strategy`/`matrix`/
 * `env`/`defaults`/`if`/`container`/`services`, workflow `env`/`defaults`, `${{ }}` in a `run:` script),
 * so a CI file it cannot mirror fails loudly instead of giving a verdict that may differ from Actions.
 */
export function parseWorkflow(yml: string): WorkflowStep[] {
  const lines = yml.split('\n');
  const steps: WorkflowStep[] = [];
  const unmirrored = (where: string, key: string) =>
    new UnmirroredWorkflowError(
      `ciLocal does not mirror ${where} key '${key}:'; refusing rather than risking a verdict that differs from Actions`,
    );
  let inJobs = false;
  let job = '';
  let jobIndent = -1;
  let jobKeyIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (isComment(line)) continue;
    const ind = indentOf(line);
    if (ind === 0) {
      const key = keyOf(line);
      inJobs = key === 'jobs';
      if (key && UNMIRRORED_TOP_KEYS.has(key)) throw unmirrored('workflow-level', key);
      continue;
    }
    if (!inJobs) continue;
    if (jobIndent < 0 || ind === jobIndent) {
      const m = /^\s*([\w-]+):\s*$/.exec(line);
      if (!m?.[1]) throw new UnmirroredWorkflowError(`ciLocal cannot parse job line: ${line.trim()}`);
      jobIndent = ind;
      jobKeyIndent = -1;
      job = m[1];
      continue;
    }
    if (ind < jobIndent) continue;
    if (jobKeyIndent < 0) jobKeyIndent = ind;
    if (ind !== jobKeyIndent) continue; // nested under a mirrored job key (permissions, needs list, ...)
    const jobKey = keyOf(line) ?? line.trim();
    if (!JOB_KEYS.has(jobKey)) throw unmirrored(`job '${job}'`, jobKey);
    if (jobKey !== 'steps') continue;
    const stepsIndent = ind;
    let cur: WorkflowStep | undefined;
    let itemIndent = -1;
    let stepKeyIndent = -1;
    let stepKeys = new Set<string>();
    const finish = () => {
      if (!cur) return;
      if (cur.run !== undefined && cur.uses !== undefined)
        throw new UnmirroredWorkflowError(`step '${cur.name}' of job '${job}' has both run: and uses:`);
      if (cur.run !== undefined && stepKeys.has('with'))
        throw unmirrored(`run: step of job '${job}'`, 'with');
      if (cur.run?.includes('${{'))
        throw new UnmirroredWorkflowError(
          `ciLocal does not evaluate \${{ }} expressions (job '${job}', run: ${cur.run.split('\n')[0]})`,
        );
      steps.push(cur);
    };
    for (i++; i < lines.length; i++) {
      const l = lines[i] as string;
      if (isComment(l)) continue;
      const li = indentOf(l);
      if (li < stepsIndent || (li === stepsIndent && !l.trimStart().startsWith('- '))) {
        i--;
        break;
      }
      let body = l.trimStart();
      let keyIndent = li;
      if (body.startsWith('- ') && (itemIndent < 0 || li === itemIndent)) {
        itemIndent = li;
        finish();
        cur = { job, name: '' };
        stepKeys = new Set();
        body = body.slice(2);
        keyIndent = li + 2 + (body.length - body.trimStart().length);
        body = body.trimStart();
        stepKeyIndent = keyIndent;
      }
      if (!cur) continue;
      if (keyIndent !== stepKeyIndent) continue; // nested under a step key (with: inputs)
      const kv = /^([\w-]+):(?:\s+(.*))?$/.exec(body);
      if (!kv?.[1]) throw new UnmirroredWorkflowError(`ciLocal cannot parse step line: ${l.trim()}`);
      const key = kv[1];
      if (!STEP_KEYS.has(key)) throw unmirrored(`step '${cur.name || '?'}' of job '${job}'`, key);
      stepKeys.add(key);
      let value = kv[2] ?? '';
      if (/^[|>][-+]?\s*$/.test(value)) {
        const folded = value.startsWith('>');
        const block: string[] = [];
        let blockIndent = -1;
        while (i + 1 < lines.length) {
          const n = lines[i + 1] as string;
          if (n.trim() && indentOf(n) <= keyIndent) break;
          i++;
          if (!n.trim()) {
            block.push('');
            continue;
          }
          if (blockIndent < 0) blockIndent = indentOf(n);
          block.push(n.slice(blockIndent));
        }
        while (block.length && block.at(-1) === '') block.pop();
        value = block.join(folded ? ' ' : '\n');
      } else value = unquote(value);
      if (key === 'name') cur.name = value;
      else if (key === 'run') cur.run = value;
      else if (key === 'uses') cur.uses = value;
      else if (key === 'timeout-minutes') {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0)
          throw new UnmirroredWorkflowError(`ciLocal cannot mirror timeout-minutes: ${value}`);
        cur.timeoutMinutes = n;
      }
    }
    finish();
  }
  return steps;
}

/** A CI script as it runs in the sandbox: `pnpm install` is forced offline. */
export function hermetic(script: string): string {
  return script
    .split('\n')
    .map((l) =>
      /^\s*pnpm\s+(install|i)\b/.test(l) && !/--offline\b/.test(l) ? `${l.replace(/\s+$/, '')} --offline` : l,
    )
    .join('\n');
}

export interface Check {
  name: string;
  run: string;
}
export type CheckInput = string | Check;

export interface StepResult {
  kind: 'ci' | 'extra' | 'image';
  name: string;
  run: string;
  code: number | null;
  ms: number;
  /** 'skipped': not run because an earlier CI step failed; 'image': a `uses:` step the image provides. */
  status: 'pass' | 'fail' | 'skipped' | 'image';
  output: string;
}

export interface CiResult {
  green: boolean;
  log: string;
  steps: StepResult[];
}

export interface CiLocalOptions {
  /** Workflow file relative to the worktree (default .github/workflows/ci.yml). */
  workflow?: string;
  /** Run in this existing container instead of a fresh one (it is not cleaned up here). */
  backend?: ExecBackend;
  backendOptions?: Partial<DockerExecBackendOptions>;
  /** Per-step timeout (default 10 min, the workflow's `timeout-minutes`). */
  stepTimeoutMs?: number;
}

const toCheck = (c: CheckInput, i: number): Check =>
  typeof c === 'string' ? { name: `extra check ${i + 1}: ${c.split('\n')[0]}`, run: c } : c;

/** GitHub's default `run:` shell on Linux: `bash --noprofile --norc -eo pipefail {0}`. */
export const RUN_SHELL = ['--noprofile', '--norc', '-eo', 'pipefail', '-c'] as const;

async function runStep(
  backend: ExecBackend,
  worktree: string,
  kind: 'ci' | 'extra',
  name: string,
  run: string,
  timeoutMs: number,
): Promise<StepResult> {
  const t0 = Date.now();
  const r = await backend.exec('bash', [...RUN_SHELL, run], { cwd: worktree, timeoutMs });
  const output = `${r.stdout}${r.stdout && r.stderr ? '\n' : ''}${r.stderr}`;
  return {
    kind,
    name,
    run,
    code: r.code,
    ms: Date.now() - t0,
    status: r.code === 0 ? 'pass' : 'fail',
    output,
  };
}

function render(steps: StepResult[]): string {
  const out: string[] = [];
  for (const s of steps) {
    out.push(`== ${s.kind}: ${s.name || s.run.split('\n')[0]}`);
    if (s.status === 'image') {
      out.push(`   (provided by the sandbox image: ${s.run})`);
      continue;
    }
    if (s.status === 'skipped') {
      out.push('   (skipped: an earlier CI step failed)');
      continue;
    }
    out.push(`$ ${s.run}`);
    if (s.output.trim()) out.push(s.output.replace(/\s+$/, ''));
    out.push(`== exit ${s.code} (${s.ms} ms) ${s.status.toUpperCase()}`);
  }
  return `${out.join('\n')}\n`;
}

async function withBackend<T>(
  worktree: string,
  image: string,
  opts: CiLocalOptions,
  fn: (b: ExecBackend) => Promise<T>,
): Promise<T> {
  if (opts.backend) return fn(opts.backend);
  const b = new DockerExecBackend({ ...opts.backendOptions, worktree, image });
  try {
    return await fn(b);
  } finally {
    await b.cleanup();
  }
}

async function runChecks(
  backend: ExecBackend,
  worktree: string,
  checks: CheckInput[],
  timeoutMs: number,
): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const [i, c] of checks.entries()) {
    const { name, run } = toCheck(c, i);
    out.push(await runStep(backend, worktree, 'extra', name, run, timeoutMs));
  }
  return out;
}

/** CI of `worktree` in `image` (+ extra checks). green = every CI step and every extra check passed. */
export async function ciLocal(
  worktree: string,
  image: string,
  extraChecks: CheckInput[] = [],
  opts: CiLocalOptions = {},
): Promise<CiResult> {
  const wfPath = join(worktree, opts.workflow ?? '.github/workflows/ci.yml');
  if (!existsSync(wfPath)) throw new Error(`no workflow at ${wfPath}`);
  const workflow = parseWorkflow(readFileSync(wfPath, 'utf8'));
  if (!workflow.some((s) => s.run)) throw new Error(`${wfPath} has no run: steps to mirror`);
  const timeoutMs = opts.stepTimeoutMs ?? 10 * 60_000;
  const steps = await withBackend(worktree, image, opts, async (backend) => {
    const out: StepResult[] = [];
    let failed = false;
    for (const s of workflow) {
      const label = s.name || s.run?.split('\n')[0] || s.uses || '';
      if (!s.run) {
        out.push({
          kind: 'image',
          name: label,
          run: s.uses ?? '',
          code: null,
          ms: 0,
          status: 'image',
          output: '',
        });
        continue;
      }
      const run = hermetic(s.run);
      if (failed) {
        out.push({ kind: 'ci', name: label, run, code: null, ms: 0, status: 'skipped', output: '' });
        continue;
      }
      const stepTimeout = s.timeoutMinutes !== undefined ? s.timeoutMinutes * 60_000 : timeoutMs;
      const r = await runStep(backend, worktree, 'ci', label, run, stepTimeout);
      out.push(r);
      if (r.status === 'fail') failed = true;
    }
    out.push(...(await runChecks(backend, worktree, extraChecks, timeoutMs)));
    return out;
  });
  return {
    green: steps.every((s) => s.status === 'pass' || s.status === 'image'),
    log: render(steps),
    steps,
  };
}

/** The same checks without CI, before a PR exists (L1's pre-PR issue validation). */
export async function runPreGate(
  worktree: string,
  image: string,
  checks: CheckInput[],
  opts: CiLocalOptions = {},
): Promise<CiResult> {
  if (!checks.length) throw new Error('runPreGate needs at least one check');
  const timeoutMs = opts.stepTimeoutMs ?? 10 * 60_000;
  const steps = await withBackend(worktree, image, opts, (b) => runChecks(b, worktree, checks, timeoutMs));
  return { green: steps.every((s) => s.status === 'pass'), log: render(steps), steps };
}
