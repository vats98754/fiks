// Registers the injector middleware factory (ORCH; PLAN P7). Every Domain's `injectorHook(rule)`
// (shop: packages/vendor-api, tracker: packages/vendor-tracker) reads this one slot, so a profile
// with an injector rule puts INJ's injector between the vendor and the tap, restarted per harness.
//
// A rule reaches the factory as a plain object. Its `transform` is relative to the rule file, so
// the module is found, in order, through: an absolute `transform`; `transformPath` (a loaded
// rule); `file` (the rule file's path); else the first rule directory whose transform matches the
// rule's hash (FIKS_INJECTOR_RULE_DIRS, colon-separated, then packages/injector/fixtures/rules).
// startInjector re-checks the hash before listening, so a wrong module is refused, never used.
// The rule clock is the Domain's frozen clock. Imports @fiks/domains and @fiks/injector (INJ),
// plus the factory slot itself from @fiks/vendor-api.
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDomains } from '@fiks/domains';
import { type LoadedRule, ruleHash, startInjector } from '@fiks/injector';
import type { InjectorRule } from '@fiks/interfaces';
import { getInjectorFactory, type InjectorFactory, registerInjectorFactory } from '@fiks/vendor-api';

const BUILTIN_RULES = fileURLToPath(new URL('../../../injector/fixtures/rules', import.meta.url));

function ruleDirs(): string[] {
  const extra = (process.env.FIKS_INJECTOR_RULE_DIRS ?? '').split(':').filter(Boolean);
  return [...extra, BUILTIN_RULES];
}

function hashMatches(rule: InjectorRule, path: string): boolean {
  try {
    return existsSync(path) && ruleHash(rule, path) === rule.hash;
  } catch {
    return false;
  }
}

/** The rule with an absolute `transformPath` (the rule as given when nothing better is found). */
function locateTransform(rule: InjectorRule & { transformPath?: string; file?: string }): LoadedRule {
  if (isAbsolute(rule.transform)) return { ...rule, file: rule.file ?? '', transformPath: rule.transform };
  if (typeof rule.transformPath === 'string' && isAbsolute(rule.transformPath))
    return { ...rule, file: rule.file ?? '', transformPath: rule.transformPath };
  if (typeof rule.file === 'string' && rule.file)
    return { ...rule, file: rule.file, transformPath: resolve(dirname(rule.file), rule.transform) };
  const candidates = ruleDirs().map((d) => resolve(d, rule.transform));
  const hit = candidates.find((p) => hashMatches(rule, p)) ?? candidates.find((p) => existsSync(p));
  return { ...rule, file: '', transformPath: hit ?? (candidates[0] as string) };
}

const factory: InjectorFactory = async ({ target, rule }) => {
  const clock = listDomains().find((d) => d.id === rule.domain)?.frozenClock;
  const inj = await startInjector({ target, rule: locateTransform(rule), ...(clock ? { clock } : {}) });
  return { url: inj.url, close: inj.close };
};

// Loaded twice under different paths (tests, copies of the CLI): the first registration wins.
if (!getInjectorFactory()) registerInjectorFactory(factory);
