// R20 held-out grading (Figma-Context-MCP #364): runs every case in heldout/cases.json through the
// server built at a head, in the SBX sandbox, and grades it with the held-out oracle
// (harness/check.ts heldoutVerdict). A head is correct when every case is ok. The blind
// contract's verdict per case is reported too (`contract`), so a contract fire on a correct head
// shows up as a false positive.
//
// usage: pnpm tsx realbugs/R20/heldout/run.ts (--sha <prefix|fix|commit> | --worktree <dir>) [--json]
// exit: 0 correct, 1 incorrect, 2 usage/setup error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Verdict } from '../../../packages/contracts/src/index.ts';
import { caseIO, evaluateCase, heldoutVerdict, loadContract } from '../harness/check.ts';
import { caseHosts, prepareBuild, R20Sandbox, SetupError } from '../harness/server.ts';
import type { HeldoutCase } from '../harness/synth-fixtures.ts';

export interface HeldoutReport {
  bugId: 'R20';
  sha: string | null;
  correct: boolean;
  cases: { id: string; kind: HeldoutCase['kind']; ok: boolean; reasons: string[]; contract: Verdict }[];
}

export const CASES_PATH = new URL('./cases.json', import.meta.url);

export function loadHeldout(): HeldoutCase[] {
  return (JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { cases: HeldoutCase[] }).cases;
}

export async function runHeldout(sel: { sha?: string; worktree?: string }): Promise<HeldoutReport> {
  const hs = loadHeldout();
  const contract = loadContract();
  const build = await prepareBuild(sel);
  const box = new R20Sandbox(build, caseHosts(hs.map((h) => h.case)));
  const cases: HeldoutReport['cases'] = [];
  try {
    for (const h of hs) {
      const run = await box.runCase(h.case);
      const v = heldoutVerdict(h.case, run, h.kind);
      cases.push({
        id: h.case.id,
        kind: h.kind,
        ok: v.ok,
        reasons: v.reasons,
        contract: evaluateCase(contract, caseIO(h.case.args, run, h.case.server.cwd)).verdict,
      });
    }
  } finally {
    await box.cleanup();
  }
  return { bugId: 'R20', sha: build.sha, correct: cases.every((c) => c.ok), cases };
}

async function main(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { sha: { type: 'string' }, worktree: { type: 'string' }, json: { type: 'boolean' } },
      strict: true,
    }));
  } catch (e) {
    console.error(`[r20] ${(e as Error).message}`);
    return 2;
  }
  if (Boolean(values.sha) === Boolean(values.worktree)) {
    console.error('usage: heldout/run.ts (--sha <ref> | --worktree <dir>) [--json]');
    return 2;
  }
  try {
    const r = await runHeldout({
      sha: values.sha as string | undefined,
      worktree: values.worktree as string | undefined,
    });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const c of r.cases) {
        console.log(
          `${c.ok ? 'ok  ' : 'FAIL'} ${c.id} (${c.kind}; contract ${c.contract})${c.reasons.length ? `: ${c.reasons.join('; ')}` : ''}`,
        );
      }
      console.log(
        `R20 held-out ${r.sha?.slice(0, 12) ?? '?'}: ${r.cases.filter((c) => c.ok).length}/${r.cases.length} ok -> ${r.correct ? 'correct' : 'incorrect'}`,
      );
    }
    return r.correct ? 0 : 1;
  } catch (e) {
    console.error(`[r20] ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof SetupError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
