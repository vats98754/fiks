import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GateResult, passGate, type ReproSpec } from '@fiks/repro';

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout}\n${r.stderr}` };
}

/** Local gate (C20, C21): repro passes, then typecheck, lint and the full suite. */
export function localGate(worktree: string, spec: ReproSpec): GateResult {
  const p = passGate(worktree, spec);
  if (!p.ok) return { ...p, gate: 'local' };
  for (const script of ['typecheck', 'lint', 'test']) {
    // `pnpm test` is `vitest run`; run it directly so a busy machine gets a longer per-test timeout.
    const args =
      script === 'test' ? ['exec', 'vitest', 'run', '--testTimeout=60000'] : ['--reporter=default', script];
    const r = sh(worktree, 'pnpm', args);
    if (r.code !== 0) {
      // Keep the end of the output: retries get it appended, and a gate_failed result stays diagnosable.
      const tail = r.out.trim().split('\n').slice(-60).join('\n');
      const logPath = join(mkdtempSync(join(tmpdir(), 'fiks-local-')), `${script}.log`);
      writeFileSync(logPath, r.out);
      return {
        gate: 'local',
        ok: false,
        reason: `pnpm ${script} failed`,
        evidence: {
          command: `pnpm ${script}`,
          exitCode: r.code,
          failed: [{ file: '', test: `pnpm ${script}`, message: tail }],
          logPath,
          runs: 1,
        },
      };
    }
  }
  return {
    gate: 'local',
    ok: true,
    reason: 'repro test, full contract suite, all traces, typecheck and lint pass',
    evidence: { command: 'pnpm typecheck && pnpm lint && pnpm test', exitCode: 0, failed: [], logPath: '' },
  };
}

export interface CiRun {
  databaseId: number;
  headSha: string;
  event: string;
  url: string;
  conclusion: string;
  status: string;
}

/** The GitHub CLI. Tests point FIKS_GH at a fake. */
export const ghBin = () => process.env.FIKS_GH ?? 'gh';
export const gh = (repo: string, args: string[]) =>
  execFileSync(ghBin(), [...args, '-R', repo], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();

/**
 * Green-CI gate (C21). Push the branch, wait for the push-triggered run on that exact commit,
 * and report its conclusion. A PR is only opened after this passes.
 */
export async function ciGate(
  repo: string,
  worktree: string,
  branch: string,
  opts: { timeoutMs?: number; pollMs?: number; onPushed?: (sha: string) => void } = {},
): Promise<GateResult & { status: 'green' | 'red' | 'timeout' | 'error' }> {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'push', '--force', '-u', 'origin', `HEAD:refs/heads/${branch}`],
    {
      cwd: worktree,
      stdio: 'pipe',
    },
  );
  opts.onPushed?.(sha);
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  const poll = opts.pollMs ?? 10_000;
  let run: CiRun | undefined;
  while (Date.now() < deadline) {
    let listed: string;
    try {
      listed = gh(repo, [
        'run',
        'list',
        '--branch',
        branch,
        '--limit',
        '10',
        '--json',
        'databaseId,headSha,event,url,conclusion,status',
      ]);
    } catch (e) {
      const reason = `could not read CI status: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
      return {
        gate: 'ci',
        ok: false,
        status: 'error',
        reason,
        evidence: { command: 'gh run list', exitCode: 1, failed: [], logPath: '' },
      };
    }
    const runs = JSON.parse(listed) as CiRun[];
    run = runs.find((r) => r.headSha === sha && r.event === 'push');
    if (run?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, poll));
  }
  const base = {
    gate: 'ci' as const,
    evidence: {
      command: `gh run view ${run?.databaseId ?? '?'}`,
      exitCode: run?.conclusion === 'success' ? 0 : 1,
      failed: [],
      logPath: '',
      url: run?.url,
    },
  };
  if (run?.status !== 'completed')
    return {
      ...base,
      ok: false,
      status: 'timeout',
      reason: `no completed CI run for ${sha.slice(0, 7)} in time`,
    };
  if (run.conclusion !== 'success')
    return { ...base, ok: false, status: 'red', reason: `CI ${run.conclusion} on ${sha.slice(0, 7)}` };
  return { ...base, ok: true, status: 'green', reason: `CI success on ${sha.slice(0, 7)}` };
}
