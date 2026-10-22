// R9 held-out grading (cloudflare/mcp-server-cloudflare #468). PR #469 is closed unmerged, so
// there is no human-fix test to grade against: a head is graded by these held-out manifestations
// only. Each case runs once through a fresh server process for the head (harness/server.ts) and
// is graded by the direction-neutral oracle (harness/check.ts gradeHeldout). The blind contract's
// verdict is printed next to it for the record; it does not grade.
//
// usage: pnpm tsx realbugs/R9/heldout/run.ts (--sha <prefix|fix|commit> | --worktree <dir>)
//          [--cases realbugs/R9/heldout/cases.json] [--json]
// exit: 0 = correct (every case passes), 1 = incorrect (some case fails), 2 = usage/setup error.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateCase, gradeHeldout, type HeldoutExpect, loadContract } from '../harness/check.ts';
import { BUG_DIR, type Case, prepareBuild, runCase, SetupError } from '../harness/server.ts';

export interface HeldoutCase extends Case {
  role: 'manifestation' | 'control';
  label: 'recorded' | 'synthesized';
  expect: HeldoutExpect;
  why: string;
}

export interface HeldoutRow {
  id: string;
  role: HeldoutCase['role'];
  tool: string;
  ok: boolean;
  reasons: string[];
  contract: string;
  unmatched: number;
}

export interface HeldoutReport {
  bugId: 'R9';
  sha: string | null;
  ref: string;
  serverKind: string;
  correct: boolean;
  rows: HeldoutRow[];
}

export function loadCases(path = join(BUG_DIR, 'heldout', 'cases.json')): HeldoutCase[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { cases: HeldoutCase[] };
  if (!Array.isArray(doc.cases) || doc.cases.length === 0) throw new Error(`${path}: no cases`);
  return doc.cases;
}

export async function runHeldout(sel: {
  sha?: string;
  worktree?: string;
  cases?: string;
}): Promise<HeldoutReport> {
  const cases = loadCases(sel.cases);
  const contract = loadContract();
  const build = await prepareBuild(sel);
  const rows: HeldoutRow[] = [];
  for (const c of cases) {
    const r = await runCase(build, c, contract);
    const io = { tool: c.tool, args: c.args, result: r.replayed.result, upstream: r.upstream };
    const g = gradeHeldout(c.expect, io);
    const e = evaluateCase(contract, io, r.replayed.evaluation);
    rows.push({
      id: c.id,
      role: c.role,
      tool: c.tool,
      ok: g.ok,
      reasons: g.reasons,
      contract: e.violations.length
        ? `violated ${e.violations.map((v) => v.propertyId).join(',')}`
        : e.verdict,
      unmatched: r.replayed.unmatched.length,
    });
  }
  return {
    bugId: 'R9',
    sha: build.sha,
    ref: sel.worktree ? `worktree:${resolve(sel.worktree)}` : (sel.sha ?? 'prefix'),
    serverKind: build.kind,
    correct: rows.every((r) => r.ok),
    rows,
  };
}

async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        sha: { type: 'string' },
        worktree: { type: 'string' },
        cases: { type: 'string' },
        json: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    console.error(`[r9 heldout] ${(e as Error).message}`);
    return 2;
  }
  if (Boolean(values.sha) === Boolean(values.worktree)) {
    console.error('usage: heldout/run.ts (--sha <ref> | --worktree <dir>) [--cases f] [--json]');
    return 2;
  }
  try {
    const report = await runHeldout({
      sha: values.sha as string | undefined,
      worktree: values.worktree as string | undefined,
      cases: values.cases as string | undefined,
    });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const r of report.rows) {
        console.log(
          `${r.ok ? 'ok  ' : 'FAIL'} ${r.id} (${r.role}, ${r.tool})${r.reasons.length ? `: ${r.reasons.join('; ')}` : ''} [contract: ${r.contract}${r.unmatched ? `, ${r.unmatched} unmatched` : ''}]`,
        );
      }
      console.log(
        `R9 held-out ${report.ref} (${report.sha?.slice(0, 12) ?? '?'}, ${report.serverKind}): ${report.correct ? 'correct' : 'incorrect'} (${report.rows.filter((r) => r.ok).length}/${report.rows.length} cases pass)`,
      );
    }
    return report.correct ? 0 : 1;
  } catch (e) {
    console.error(`[r9 heldout] ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof SetupError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
