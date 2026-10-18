import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh } from '@fiks/repair';
import { appendEvent, readEvents, runSuite } from '@fiks/repro';
import { FIKS_DIR, shopDir } from '../paths.ts';
import type { RepairResult } from './repair.ts';
import { runScenario } from './scenario.ts';

export interface ConfirmResult {
  traceId: string;
  scenario?: string;
  pr: string;
  merged: boolean;
  mergedAt?: string;
  confirmed: boolean;
  violations: number;
  calls: number;
  reason: string;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function repairs(): RepairResult[] {
  const dir = join(FIKS_DIR, 'repairs');
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RepairResult)
      .filter((r) => r.status === 'pr_opened' && r.pr);
  } catch {
    return [];
  }
}

/**
 * After a human merges fiks PRs: record the merge, move the shop-mcp clone to the merged main,
 * re-run each repaired drift live against the real (full) v2 upstream, and record `confirmed`
 * only if its target properties are no longer violated.
 */
export async function confirm(): Promise<ConfirmResult[]> {
  const repo = process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp';
  const events = join(FIKS_DIR, 'events.jsonl');
  const seen = readEvents(events);
  const out: ConfirmResult[] = [];
  const todo = repairs();
  const merged: { r: RepairResult; mergedAt: string }[] = [];
  for (const r of todo) {
    const pr = r.pr as { number: number; url: string };
    const v = JSON.parse(gh(repo, ['pr', 'view', String(pr.number), '--json', 'state,mergedAt'])) as {
      state: string;
      mergedAt: string | null;
    };
    if (v.state !== 'MERGED' || !v.mergedAt) {
      out.push({
        traceId: r.traceId,
        scenario: r.scenario,
        pr: pr.url,
        merged: false,
        confirmed: false,
        violations: 0,
        calls: 0,
        reason: `PR is ${v.state.toLowerCase()}`,
      });
      continue;
    }
    merged.push({ r, mergedAt: v.mergedAt });
    if (!seen.some((e) => e.type === 'pr_merged' && e.traceId === r.traceId)) {
      appendEvent(events, {
        ts: v.mergedAt,
        runId: 'confirm',
        type: 'pr_merged',
        traceId: r.traceId,
        propertyId: r.propertyIds.join(','),
        data: { url: pr.url },
      });
    }
  }
  if (merged.length === 0) return out;

  const shop = shopDir();
  git(shop, 'fetch', '--quiet', 'origin', 'main');
  git(shop, 'checkout', '--quiet', 'main');
  git(shop, 'merge', '--ff-only', '--quiet', 'origin/main');
  const sha = git(shop, 'rev-parse', '--short', 'HEAD');
  // Replay: every stored trace and repro test, plus the contract suite, on the merged code.
  const replay = runSuite(shop);
  const replayOk = replay.exitCode === 0 && replay.suiteErrors.length === 0;

  for (const { r, mergedAt } of merged) {
    if (!r.scenario) continue;
    const run = await runScenario(r.scenario, { profile: 'full', traceDir: false, runId: `confirm_${sha}` });
    const target = new Set(r.propertyIds);
    const violations = run.calls
      .flatMap((c) => c.receipt?.violations ?? [])
      .filter((v) => target.has(v.propertyId)).length;
    const confirmed = violations === 0 && replayOk;
    // `confirmed` is recorded only when it holds: live re-run clean and every trace replays clean.
    if (confirmed) {
      appendEvent(events, {
        runId: 'confirm',
        type: 'confirmed',
        traceId: r.traceId,
        propertyId: r.propertyIds.join(','),
        ok: true,
        data: {
          shopMcpSha: sha,
          calls: run.calls.length,
          violations,
          scenario: r.scenario,
          replayedTests: replay.files.length,
        },
      });
    }
    out.push({
      traceId: r.traceId,
      scenario: r.scenario,
      pr: r.pr?.url ?? '',
      merged: true,
      mergedAt,
      confirmed,
      violations,
      calls: run.calls.length,
      reason: confirmed
        ? `0 violations of ${[...target].join(', ')} live, and all ${replay.files.length} test files (traces, repros, contracts) pass on main ${sha}`
        : `${violations} live violations; replay ${replayOk ? 'passes' : 'FAILS'} on main ${sha}`,
    });
  }
  return out;
}
