// Freeze-ledger checker (PLAN.md 5.2).
//
//   pnpm tsx paper/prereg/check-ledger.ts [--ledger <file>] [--repo <dir>] [--allow-missing-external]
//   pnpm tsx paper/prereg/check-ledger.ts --selftest
//
// Exit 0 = PASS, 1 = FAIL, 2 = usage error. The self-test builds toy repositories in the OS temp
// dir and must fail on out-of-order or non-ancestor tags, F4b after F5, and an external ref that is
// a tag object rather than its peeled commit, and pass on the correct order.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/git.ts';
import { checkLedger } from './lib/ledger.ts';
import { CASES, runCases } from './lib/ledger-selftest.ts';

const USAGE =
  'usage: check-ledger.ts [--ledger <file>] [--repo <dir>] [--allow-missing-external] | --selftest';

function selftest(): number {
  let failed = 0;
  for (const o of runCases()) {
    const first = o.result.errors[0] ?? '';
    console.log(
      `${o.ok ? 'ok  ' : 'BAD '} expect ${o.expect}, got ${o.got}: ${o.name}${o.got === 'fail' ? ` -- ${first}` : ''}`,
    );
    if (!o.ok) {
      failed++;
      for (const e of o.result.errors) console.log(`       ${e}`);
    }
  }
  console.log(failed === 0 ? `selftest PASS (${CASES.length} cases)` : `selftest FAIL (${failed} cases)`);
  return failed === 0 ? 0 : 1;
}

function main(argv: string[]): number {
  if (argv.includes('--selftest')) return selftest();
  const here = fileURLToPath(new URL('.', import.meta.url));
  let ledgerPath = resolve(here, 'freeze-ledger.json');
  let repo = repoRoot(here);
  let allowMissingExternal = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger' && argv[i + 1] !== undefined) ledgerPath = resolve(argv[++i] as string);
    else if (a === '--repo' && argv[i + 1] !== undefined) repo = resolve(argv[++i] as string);
    else if (a === '--allow-missing-external') allowMissingExternal = true;
    else {
      console.error(USAGE);
      return 2;
    }
  }
  let ledger: unknown;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    console.error(`cannot read ${ledgerPath}: ${(e as Error).message}`);
    return 1;
  }
  const r = checkLedger(ledger, { repo, allowMissingExternal });
  for (const p of r.passes) console.log(`ok   ${p}`);
  for (const w of r.warnings) console.log(`WARN ${w}`);
  for (const e of r.errors) console.log(`FAIL ${e}`);
  const recorded = (ledger as { freezes?: { record: unknown }[] }).freezes?.filter(
    (f) => f.record !== null,
  ).length;
  console.log(
    r.errors.length === 0
      ? `check-ledger PASS (${recorded ?? 0} of 11 freezes recorded; repo ${repo})`
      : `check-ledger FAIL (${r.errors.length} errors)`,
  );
  return r.errors.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
