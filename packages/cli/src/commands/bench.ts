import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Outcome, runAgent, TASKS } from '@fiks/bench';
import { SHOP_CONTRACTS_PATH } from '@fiks/contracts';
import { gh } from '@fiks/repair';
import { addWorktree } from '@fiks/repro';
import { createVendor, type VendorVersion } from '@fiks/vendor-api';
import { ROOT, shopDir, WORK_DIR } from '../paths.ts';

export type PhaseLabel = 'A_v1' | 'B_v2' | 'B_v2_direct' | 'C_v2_fixed' | 'C_v2_prheads';

export interface TrialRecord {
  runId: string;
  phase: PhaseLabel;
  taskId: string;
  drift: string | null;
  trial: number;
  pass: boolean;
  outcome: Outcome;
  reason: string;
  answer: string | null;
  calls: { tool: string; verdict: string; propertyIds: string[] }[];
  model: string;
  shopMcpSha: string;
  startedAt: string;
  durationMs: number;
  turns: number;
  usage: { input: number; output: number };
  error?: string;
}

const PHASES: Record<'A' | 'B' | 'C', { label: PhaseLabel; vendor: VendorVersion; ref: string }> = {
  A: { label: 'A_v1', vendor: 'v1', ref: 'seed-v1' },
  B: { label: 'B_v2', vendor: 'v2', ref: 'seed-v1' },
  C: { label: 'C_v2_fixed', vendor: 'v2', ref: 'origin/main' },
};

interface FixPr {
  number: number;
  branch: string;
  state: string;
}

/** The fix PRs fiks opened (from the committed loop evidence) and their current state. */
function fixPrs(): FixPr[] {
  const dir = join(ROOT, 'bench/results/loop/repairs');
  if (!existsSync(dir)) return [];
  const repo = process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp';
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { branch: string; pr?: { number: number } })
    .filter((r) => r.pr)
    .map((r) => {
      const v = JSON.parse(gh(repo, ['pr', 'view', String(r.pr?.number), '--json', 'state'])) as {
        state: string;
      };
      return { number: r.pr?.number as number, branch: r.branch, state: v.state };
    });
}

/** A local branch: origin/main plus every open fix PR branch merged in. Throws on conflict. */
function mergePrHeads(branches: string[]): string {
  const name = `bench/pr-heads-${Date.now()}`;
  const dir = join(WORK_DIR, 'wt', name.replace('/', '-'));
  const wt = addWorktree(shopDir(), dir, 'origin/main', name);
  try {
    for (const b of branches) {
      git(wt.dir, 'fetch', '--quiet', 'origin', b);
      try {
        git(
          wt.dir,
          '-c',
          'user.email=fiks@local',
          '-c',
          'user.name=fiks',
          'merge',
          '--no-edit',
          '--quiet',
          'FETCH_HEAD',
        );
      } catch {
        throw new Error(`phase C pr-heads: ${b} does not merge cleanly with the others`);
      }
    }
    return git(wt.dir, 'rev-parse', 'HEAD');
  } finally {
    wt.remove();
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

export async function bench(opts: {
  phase: 'A' | 'B' | 'C';
  k: number;
  tasks?: string[];
  model?: string;
  /** Phase C only: 'pr-heads' runs a temporary merge of the open fix PR branches. */
  shopRef?: 'pr-heads';
  out?: string;
  /** No fiks-proxy: the agent talks to shop-mcp directly (the "without fiks" baseline). */
  direct?: boolean;
  /** Pass `--receipt-field none` to the proxy (receipt only in _meta and a text block). */
  noReceiptField?: boolean;
  onTrial?: (t: TrialRecord) => void;
}) {
  const p = PHASES[opts.phase];
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'bench needs a Claude credential: CLAUDE_CODE_OAUTH_TOKEN in .env (from `claude setup-token`)',
    );
  }
  git(shopDir(), 'fetch', '--quiet', 'origin', '--tags');
  // Phase C must say exactly what code ran: merged main only when every fix PR is merged,
  // otherwise an explicit, differently labelled merge of the PR branches.
  let phaseLabel: PhaseLabel = p.label;
  let ref = p.ref;
  if (opts.phase === 'C') {
    const prs = fixPrs();
    if (prs.length === 0) throw new Error('phase C: no fix PRs recorded in bench/results/loop/repairs');
    const open = prs.filter((x) => x.state !== 'MERGED');
    if (open.length === 0) {
      ref = 'origin/main';
    } else if (opts.shopRef === 'pr-heads') {
      phaseLabel = 'C_v2_prheads';
      ref = mergePrHeads(open.map((x) => x.branch));
    } else {
      throw new Error(
        `phase C: PRs not merged yet (${open.map((x) => `#${x.number}`).join(', ')}). Merge them, or pass --shop-ref pr-heads.`,
      );
    }
  }
  const label = opts.direct ? (`${phaseLabel}_direct` as PhaseLabel) : phaseLabel;
  const model = opts.model ?? process.env.BENCH_MODEL ?? 'claude-sonnet-5-5';
  const startedAt = new Date().toISOString();
  const runId = `${label}_${startedAt.replace(/[-:.]/g, '').slice(0, 15)}`;
  const tasks = TASKS.filter((t) => !opts.tasks?.length || opts.tasks.includes(t.id));
  // Only full runs (every task, k >= 5) go to the committed evidence; partial runs go to scratch.
  const full = tasks.length === TASKS.length && opts.k >= 5;
  const out = opts.out ?? join(ROOT, full ? 'bench/results' : '.fiks/bench', runId);
  mkdirSync(join(out, 'transcripts'), { recursive: true });

  const wt = addWorktree(shopDir(), join(WORK_DIR, 'wt', `bench-${runId}`), ref);
  const shopMcpSha = git(wt.dir, 'rev-parse', 'HEAD');
  const vendor = createVendor({ version: p.vendor });
  const vendorUrl = await vendor.listen();
  const meta = {
    runId,
    phase: label,
    fiksSha: git(ROOT, 'rev-parse', 'HEAD'),
    fiksDirty: git(ROOT, 'status', '--porcelain').length > 0,
    proxy: !opts.direct,
    receiptField: !opts.direct && !opts.noReceiptField,
    model,
    k: opts.k,
    tasks: tasks.map((t) => t.id),
    shopRef: ref,
    shopMcpSha,
    vendor: p.vendor,
    vendorDrifts: vendor.state.drifts,
    startedAt,
    finishedAt: '',
  };
  writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const trials: TrialRecord[] = [];
  try {
    for (const task of tasks) {
      for (let trial = 1; trial <= opts.k; trial++) {
        vendor.reset();
        const proxyEvents = join(out, 'proxy', `${task.id}-${trial}.jsonl`);
        mkdirSync(join(out, 'proxy'), { recursive: true });
        rmSync(proxyEvents, { force: true });
        const t0 = Date.now();
        const run = await runAgent({
          prompt: task.prompt,
          model,
          shop: opts.direct
            ? {
                command: join(wt.dir, 'node_modules/.bin/tsx'),
                args: [join(wt.dir, 'src/main.ts')],
                env: {
                  VENDOR_BASE_URL: vendorUrl,
                  PATH: process.env.PATH ?? '',
                  HOME: process.env.HOME ?? '',
                },
              }
            : {
                command: join(ROOT, 'node_modules/.bin/tsx'),
                args: [
                  join(ROOT, 'packages/proxy/src/bin.ts'),
                  '--contracts',
                  SHOP_CONTRACTS_PATH,
                  '--tap',
                  'VENDOR_BASE_URL',
                  '--events',
                  proxyEvents,
                  ...(opts.noReceiptField ? ['--receipt-field', 'none'] : []),
                  '--',
                  join(wt.dir, 'node_modules/.bin/tsx'),
                  join(wt.dir, 'src/main.ts'),
                ],
                env: {
                  VENDOR_BASE_URL: vendorUrl,
                  PATH: process.env.PATH ?? '',
                  HOME: process.env.HOME ?? '',
                },
              },
        });
        const grade = task.grade(run.answer ?? '', vendor.state);
        const calls = existsSync(proxyEvents)
          ? readFileSync(proxyEvents, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map(
                (l) =>
                  JSON.parse(l) as {
                    tool: string;
                    receipt: { verdict: string; violations: { propertyId: string }[] };
                  },
              )
              .map((c) => ({
                tool: c.tool,
                verdict: c.receipt.verdict,
                propertyIds: c.receipt.violations.map((v) => v.propertyId),
              }))
          : [];
        const rec: TrialRecord = {
          runId,
          phase: label,
          taskId: task.id,
          drift: task.drift ?? null,
          trial,
          pass: run.answer !== null && grade.pass,
          outcome: run.answer === null ? 'wrong' : grade.outcome,
          reason:
            run.answer === null ? `no answer submitted${run.error ? ` (${run.error})` : ''}` : grade.reason,
          answer: run.answer,
          calls,
          model,
          shopMcpSha,
          startedAt: new Date(t0).toISOString(),
          durationMs: Date.now() - t0,
          turns: run.turns,
          usage: run.usage,
          ...(run.error ? { error: run.error } : {}),
        };
        appendFileSync(join(out, 'trials.jsonl'), `${JSON.stringify(rec)}\n`);
        writeFileSync(join(out, 'transcripts', `${task.id}-${trial}.txt`), `${run.transcript.join('\n')}\n`);
        trials.push(rec);
        opts.onTrial?.(rec);
      }
    }
  } finally {
    await vendor.close();
    wt.remove();
    meta.finishedAt = new Date().toISOString();
    writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  }
  return { runId, out, meta, trials };
}
