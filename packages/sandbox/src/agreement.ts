// Local-CI vs GitHub Actions agreement check (PLAN §8.0-4: Actions minutes approved for 20 heads).
// For each head: ciLocal() in the sandbox image, then (only with --push) the head is pushed as a
// branch `sbx-agree/<sha12>` to a vats98754-owned repo and the Actions verdict of that push is read
// with `gh run list`. Prints and writes the per-head table and the agreement rate.
//
// It never opens a pull request, never pushes to a repo whose base owner is not vats98754 (forks
// whose parent is elsewhere are refused too), and pushes only `sbx-agree/*` branches.
//
// usage: pnpm tsx packages/sandbox/src/agreement.ts --repo .work/shop-mcp --heads <sha,sha,…|@file>
//          [--slug vats98754/shop-mcp] [--image <digest>] [--push] [--cleanup] [--out agreement.json]
//   without --push it is a dry run: local verdicts plus the branches it would push.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRepoImage } from './build.ts';
import { ciLocal } from './ci-local.ts';

export const ALLOWED_OWNER = 'vats98754';
export const BRANCH_PREFIX = 'sbx-agree/';

export const branchFor = (sha: string) => `${BRANCH_PREFIX}${sha.slice(0, 12)}`;

/** `owner/name` from a GitHub remote URL (https or ssh), else undefined. */
export function slugFromRemote(url: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

export interface RepoView {
  owner: { login: string };
  isFork: boolean;
  parent?: { owner?: { login: string } } | null;
}

/** Throws unless the base repository (and a fork's parent) is owned by vats98754. */
export function assertAllowedRepo(slug: string, view: RepoView): void {
  const owner = slug.split('/')[0];
  if (owner !== ALLOWED_OWNER) throw new Error(`refusing ${slug}: owner is not ${ALLOWED_OWNER}`);
  if (view.owner.login !== ALLOWED_OWNER)
    throw new Error(`refusing ${slug}: GitHub owner is ${view.owner.login}`);
  if (view.isFork && view.parent?.owner?.login !== ALLOWED_OWNER) {
    throw new Error(`refusing ${slug}: a fork of ${view.parent?.owner?.login ?? 'unknown'}`);
  }
}

/** The only gh invocations this script makes; anything mentioning a PR is refused outright. */
function gh(args: string[]): string {
  if (args.some((a) => /^pr$/i.test(a))) throw new Error('agreement.ts never touches pull requests');
  return execFileSync('gh', args, { encoding: 'utf8' });
}

export interface AgreementRow {
  head: string;
  branch: string;
  local: 'green' | 'red';
  actions: 'green' | 'red' | 'not-run' | 'timeout';
  agree: boolean | null;
  runUrl?: string;
}

export function summarize(rows: AgreementRow[]): { compared: number; agreed: number; rate: number | null } {
  const compared = rows.filter((r) => r.agree !== null);
  const agreed = compared.filter((r) => r.agree).length;
  return { compared: compared.length, agreed, rate: compared.length ? agreed / compared.length : null };
}

async function actionsVerdict(
  slug: string,
  branch: string,
  sha: string,
  timeoutMs: number,
): Promise<{ verdict: AgreementRow['actions']; url?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const runs = JSON.parse(
      gh([
        'run',
        'list',
        '--repo',
        slug,
        '--branch',
        branch,
        '--event',
        'push',
        '--json',
        'headSha,status,conclusion,url',
        '--limit',
        '5',
      ]),
    ) as { headSha: string; status: string; conclusion: string; url: string }[];
    const run = runs.find((r) => r.headSha === sha);
    if (run?.status === 'completed') {
      return { verdict: run.conclusion === 'success' ? 'green' : 'red', url: run.url };
    }
    await sleep(15_000);
  }
  return { verdict: 'timeout' };
}

export async function runAgreement(opts: {
  repo: string;
  heads: string[];
  slug?: string;
  image?: string;
  push?: boolean;
  cleanup?: boolean;
  timeoutMs?: number;
  log?: (s: string) => void;
}): Promise<AgreementRow[]> {
  const log = opts.log ?? ((s: string) => console.error(s));
  const repo = realpathSync(resolve(opts.repo));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd: repo, encoding: 'utf8' }).trim();
  const slug = opts.slug ?? slugFromRemote(git('remote', 'get-url', 'origin'));
  if (!slug) throw new Error('cannot tell the GitHub repo; pass --slug owner/name');
  if (slug.split('/')[0] !== ALLOWED_OWNER)
    throw new Error(`refusing ${slug}: owner is not ${ALLOWED_OWNER}`);
  if (opts.push) {
    assertAllowedRepo(
      slug,
      JSON.parse(gh(['repo', 'view', slug, '--json', 'owner,isFork,parent'])) as RepoView,
    );
  }
  const image = opts.image ?? (await buildRepoImage({ repo })).digest;
  const rows: AgreementRow[] = [];
  for (const h of opts.heads) {
    const sha = git('rev-parse', `${h}^{commit}`);
    const branch = branchFor(sha);
    const wt = mkdtempSync(join(tmpdir(), 'fiks-agree-'));
    rmSync(wt, { recursive: true });
    git('worktree', 'add', '--detach', wt, sha);
    let local: AgreementRow['local'];
    try {
      local = (await ciLocal(wt, image)).green ? 'green' : 'red';
    } finally {
      git('worktree', 'remove', '--force', wt);
    }
    let actions: AgreementRow['actions'] = 'not-run';
    let runUrl: string | undefined;
    if (opts.push) {
      // Explicit URL and refspec: exactly one sbx-agree branch on the checked repo, nothing else.
      execFileSync('git', ['push', `https://github.com/${slug}.git`, `${sha}:refs/heads/${branch}`], {
        cwd: repo,
        stdio: 'inherit',
      });
      const v = await actionsVerdict(slug, branch, sha, opts.timeoutMs ?? 20 * 60_000);
      actions = v.verdict;
      runUrl = v.url;
      if (opts.cleanup) {
        execFileSync('git', ['push', `https://github.com/${slug}.git`, `:refs/heads/${branch}`], {
          cwd: repo,
          stdio: 'inherit',
        });
      }
    } else log(`[dry run] would push ${sha} to ${slug} as ${branch}`);
    const agree = actions === 'green' || actions === 'red' ? actions === local : null;
    rows.push({ head: sha, branch, local, actions, agree, ...(runUrl ? { runUrl } : {}) });
    log(
      `${sha.slice(0, 12)} local=${local} actions=${actions}${agree === null ? '' : agree ? ' AGREE' : ' DISAGREE'}`,
    );
  }
  return rows;
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      heads: { type: 'string' },
      slug: { type: 'string' },
      image: { type: 'string' },
      push: { type: 'boolean', default: false },
      cleanup: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  if (!values.repo || !values.heads) {
    console.error(
      'usage: agreement.ts --repo <dir> --heads <sha,…|@file> [--push] [--cleanup] [--out f.json]',
    );
    return 2;
  }
  const heads = (
    values.heads.startsWith('@')
      ? readFileSync(values.heads.slice(1), 'utf8')
      : values.heads.replace(/,/g, '\n')
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = await runAgreement({
    repo: values.repo,
    heads,
    slug: values.slug,
    image: values.image,
    push: values.push,
    cleanup: values.cleanup,
  });
  const report = { at: new Date().toISOString(), rows, ...summarize(rows) };
  if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`agreement: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
