import { execFileSync } from 'node:child_process';
import { shopDir } from '../paths.ts';
import { type RepairResult, repair } from './repair.ts';
import { repro } from './repro.ts';

export interface DemoResult {
  base: string;
  credential: boolean;
  results: (Pick<
    RepairResult,
    'status' | 'reason' | 'traceId' | 'propertyIds' | 'branch' | 'attempts' | 'turns'
  > & {
    scenario: string;
    pr?: string;
    gateF?: string;
  })[];
  missing?: string;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/**
 * The whole loop, once per drift: v2 traffic through fiks-proxy -> violation -> trace -> repro
 * (F gate) -> repair agent -> local gates -> green CI -> PR. Prints PR URLs and stops; it never
 * merges. With `base: 'fresh'` the PRs target a new demo/<runId> branch cut from seed-v1, so the
 * demo can be repeated after earlier fixes were merged into main.
 */
export async function demo(opts: {
  drifts: string[];
  base?: 'fresh' | 'main';
  untilFGate?: boolean;
}): Promise<DemoResult> {
  const credential = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
  // Offline (explicit --until-f-gate, or no credential): never calls the model, never pushes.
  if (!credential || opts.untilFGate) {
    // No model access: run everything up to and including the F gate, then say what is missing.
    const results: DemoResult['results'] = [];
    for (const d of opts.drifts) {
      const r = await repro({ scenario: d, runs: 3 });
      results.push({
        scenario: d,
        status: r.gateF.ok ? 'ready' : 'gate_failed',
        reason: `F gate: ${r.gateF.reason}`,
        traceId: r.trace.id,
        propertyIds: r.spec.propertyIds,
        branch: '',
        attempts: 0,
        turns: 0,
        gateF: r.gateF.reason,
      });
    }
    return {
      base: 'seed-v1',
      credential,
      results,
      missing: credential
        ? undefined
        : 'CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) in .env: needed for the repair agent. Stopped after the F gate.',
    };
  }
  let base = 'main';
  if (opts.base === 'fresh') {
    base = `demo/${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
    git(shopDir(), 'fetch', '--quiet', 'origin', '--tags');
    git(shopDir(), 'push', '--quiet', 'origin', `seed-v1^{commit}:refs/heads/${base}`);
  }
  const results: DemoResult['results'] = [];
  for (const d of opts.drifts) {
    const r = await repair({ scenario: d, base });
    results.push({
      scenario: d,
      status: r.status,
      reason: r.reason,
      traceId: r.traceId,
      propertyIds: r.propertyIds,
      branch: r.branch,
      attempts: r.attempts,
      turns: r.turns,
      pr: r.pr?.url,
      gateF: r.gates.find((g) => g.gate === 'F')?.reason,
    });
  }
  return { base, credential, results };
}
