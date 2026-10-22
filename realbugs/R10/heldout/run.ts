// R10 held-out grading (servers #4887): runs every case in heldout/cases.json through the memory
// server built at a head and grades it with the held-out oracle (harness/check.ts heldoutVerdict).
// A head is correct when every case is ok. The blind contract's verdict per case is reported too
// (`contract`), so a contract fire on a correct head shows up as a false positive.
//
// usage: pnpm tsx realbugs/R10/heldout/run.ts (--sha <prefix|fix|commit> | --worktree <dir>) [--json]
// exit: 0 correct, 1 incorrect, 2 usage/setup error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Verdict } from '../../../packages/contracts/src/index.ts';
import {
  type EntityLike,
  evaluateCase,
  type HeldoutVerdict,
  heldoutVerdict,
  loadContract,
} from '../harness/check.ts';
import { type Case, prepareBuild, runCase, SetupError } from '../harness/server.ts';

interface HeldoutCase {
  id: string;
  kind: 'manifestation' | 'control';
  state: unknown[];
  entities: EntityLike[];
}

export interface HeldoutReport {
  bugId: 'R10';
  sha: string | null;
  correct: boolean;
  cases: { id: string; kind: HeldoutCase['kind']; ok: boolean; reasons: string[]; contract: Verdict }[];
}

export const CASES_PATH = new URL('./cases.json', import.meta.url);

export async function runHeldout(sel: { sha?: string; worktree?: string }): Promise<HeldoutReport> {
  const file = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as { capturedAt: string; cases: HeldoutCase[] };
  const contract = loadContract();
  const build = await prepareBuild(sel);
  const cases: HeldoutReport['cases'] = [];
  for (const h of file.cases) {
    const c: Case = {
      id: h.id,
      capturedAt: file.capturedAt,
      tool: 'create_entities',
      args: { entities: h.entities },
      state: { lines: h.state },
    };
    const r = await runCase(build, c);
    const v: HeldoutVerdict = heldoutVerdict(r, { control: h.kind === 'control' });
    cases.push({
      id: h.id,
      kind: h.kind,
      ok: v.ok,
      reasons: v.reasons,
      contract: evaluateCase(contract, r).verdict,
    });
  }
  return { bugId: 'R10', sha: build.sha, correct: cases.every((c) => c.ok), cases };
}

async function main(argv: string[]): Promise<number> {
  let values: { sha?: string; worktree?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { sha: { type: 'string' }, worktree: { type: 'string' }, json: { type: 'boolean' } },
      strict: true,
    }));
  } catch (e) {
    console.error(`[r10-heldout] ${(e as Error).message}`);
    return 2;
  }
  if (Boolean(values.sha) === Boolean(values.worktree)) {
    console.error('usage: heldout/run.ts (--sha <ref> | --worktree <dir>) [--json]');
    return 2;
  }
  try {
    const report = await runHeldout({ sha: values.sha, worktree: values.worktree });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const c of report.cases) {
        console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.id} (${c.kind}; blind contract: ${c.contract})`);
        for (const r of c.reasons) console.log(`     ${r}`);
      }
      console.log(
        `R10 heldout ${report.sha?.slice(0, 12) ?? '?'}: ${report.correct ? 'correct' : 'incorrect'}`,
      );
    }
    return report.correct ? 0 : 1;
  } catch (e) {
    console.error(`[r10-heldout] ${e instanceof Error ? e.message : String(e)}`);
    return e instanceof SetupError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}
