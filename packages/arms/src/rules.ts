// Injector rules fiks ships (INJ's dev drifts, DOM2's TRK-DEV-1), found by the id and hash a
// trace's re-record profile names (P7). Light on purpose: the test-only injector bootstrap loads it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InjectorRule, RerecordProfile } from '@fiks/interfaces';

export const FIKS_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

/** Injector rule files fiks ships (INJ dev drifts, DOM2's TRK-DEV-1); matched by id and hash. */
export function knownRuleFiles(root = FIKS_ROOT): string[] {
  const out: string[] = [];
  const rules = join(root, 'packages/injector/fixtures/rules');
  if (existsSync(rules))
    for (const f of readdirSync(rules).sort()) if (f.endsWith('.json')) out.push(join(rules, f));
  const pkgs = join(root, 'packages/vendor-tracker/fixtures/driftpkgs');
  if (existsSync(pkgs))
    for (const d of readdirSync(pkgs).sort())
      if (existsSync(join(pkgs, d, 'rule.json'))) out.push(join(pkgs, d, 'rule.json'));
  return out;
}

export function findRule(profile: RerecordProfile, files = knownRuleFiles()): InjectorRule | undefined {
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(f, 'utf8')) as InjectorRule;
      if (r.id === profile.ruleId && r.hash === profile.ruleHash) return r;
    } catch {
      // not a rule file
    }
  }
  return undefined;
}
