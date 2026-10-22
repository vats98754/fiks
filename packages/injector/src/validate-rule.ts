#!/usr/bin/env node
// Validates injector rule files and DriftPackage manifests (a manifest is checked together with
// the rule it points to). Exit 0 = all valid, 1 = a problem, 2 = usage error.
//
// usage: pnpm tsx packages/injector/src/validate-rule.ts [--complete] [--write-hash] <file.json>...
//   --complete    manifests must also carry the grader part (hidden tests, refA, refB, renamed-id)
//   --write-hash  recompute and store rule hashes (rule files, then the manifests pointing at them)
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadDriftPackage, validateDriftPackage } from './driftpkg.ts';
import { readRule, ruleHash, validateRule } from './rule.ts';

type Kind = 'rule' | 'manifest' | 'unknown';

function kindOf(file: string): Kind {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (raw && typeof raw === 'object' && 'injectorRule' in raw) return 'manifest';
    if (raw && typeof raw === 'object' && 'transform' in raw) return 'rule';
  } catch {
    // reported as unknown below
  }
  return 'unknown';
}

function writeJson(file: string, value: unknown) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeHashes(files: string[]) {
  for (const f of files.filter((x) => kindOf(x) === 'rule')) {
    const rule = readRule(f);
    const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    raw.hash = ruleHash(rule, rule.transformPath);
    writeJson(f, raw);
  }
  for (const f of files.filter((x) => kindOf(x) === 'manifest')) {
    const { rulePath } = loadDriftPackage(f);
    const rule = readRule(rulePath);
    const hash = ruleHash(rule, rule.transformPath);
    const ruleRaw = JSON.parse(readFileSync(rulePath, 'utf8')) as Record<string, unknown>;
    if (ruleRaw.hash !== hash) writeJson(rulePath, { ...ruleRaw, hash });
    const raw = JSON.parse(readFileSync(f, 'utf8')) as { injectorRule: { path: string; hash: string } };
    raw.injectorRule.hash = hash;
    writeJson(f, raw);
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: { values: { complete?: boolean; 'write-hash'?: boolean }; positionals: string[] };
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { complete: { type: 'boolean' }, 'write-hash': { type: 'boolean' } },
    });
  } catch (e) {
    console.error(`[validate-rule] ${(e as Error).message}`);
    return 2;
  }
  const files = parsed.positionals;
  if (!files.length) {
    console.error('usage: validate-rule [--complete] [--write-hash] <rule-or-manifest.json>...');
    return 2;
  }
  if (parsed.values['write-hash']) writeHashes(files);
  let bad = 0;
  for (const f of files) {
    const kind = kindOf(f);
    const { errors, label } =
      kind === 'manifest'
        ? await validateDriftPackage(f, { complete: parsed.values.complete }).then((r) => ({
            errors: r.errors,
            label: r.pkg
              ? `driftpkg ${r.pkg.id} (base ${r.pkg.base}, rule ${r.pkg.injectorRule.hash.slice(0, 12)})`
              : 'driftpkg',
          }))
        : kind === 'rule'
          ? await validateRule(f).then((r) => ({
              errors: r.errors,
              label: r.rule
                ? `rule ${r.rule.id} (${r.rule.match.method} ${r.rule.match.pathPattern})`
                : 'rule',
            }))
          : { errors: ['not a rule (no "transform") or manifest (no "injectorRule") JSON file'], label: '?' };
    if (errors.length) {
      bad++;
      console.log(`FAIL ${f}: ${label}`);
      for (const e of errors) console.log(`  - ${e}`);
    } else {
      console.log(`ok   ${f}: ${label}`);
    }
  }
  console.log(`${files.length - bad}/${files.length} valid`);
  return bad ? 1 : 0;
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main(process.argv.slice(2));
}
