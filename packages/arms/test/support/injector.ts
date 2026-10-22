// TEST-ONLY injector factory: packages/injector's startInjector behind the harness's injector hook
// (the factory ORCH's packages/cli/src/bootstrap/30-injector.ts registers in the product). The rule
// object the harness passes is matched by id and hash to one of fiks's rule files, whose transform
// path is relative to the file. Used in-process by fixture generation and, when 30-injector.ts is
// not in the tree, by the test-only fiks-tools image (see tools-image.ts).
import { getDomain, listDomains } from '@fiks/domains';
import { startInjector } from '@fiks/injector';
import type { InjectorRule } from '@fiks/interfaces';
import { getInjectorFactory, registerInjectorFactory } from '../../../vendor-api/src/domain.ts';
import { knownRuleFiles } from '../../src/rules.ts';

/** Frozen clock of the rule's domain (shop and tracker use the same constant instant). */
const clockOf = (rule: InjectorRule) =>
  listDomains().some((d) => d.id === rule.domain)
    ? getDomain(rule.domain).frozenClock
    : '2026-10-01T12:00:00.000Z';

export async function armsTestInjectorFactory({ target, rule }: { target: string; rule: InjectorRule }) {
  const { readFileSync } = await import('node:fs');
  const file = knownRuleFiles().find((f) => {
    try {
      const r = JSON.parse(readFileSync(f, 'utf8')) as InjectorRule;
      return r.id === rule.id && r.hash === rule.hash;
    } catch {
      return false;
    }
  });
  if (!file) throw new Error(`test injector: no rule file for ${rule.id} (hash ${rule.hash})`);
  const inj = await startInjector({ target, rule: file, clock: clockOf(rule) });
  return { url: inj.url, close: () => inj.close() };
}

/** Registers the factory unless one is registered already (ORCH's bootstrap wins). */
export function registerArmsTestInjector(): void {
  if (!getInjectorFactory()) registerInjectorFactory(armsTestInjectorFactory);
}
