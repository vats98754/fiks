// The harness's injector factory (vendor-api `registerInjectorFactory`, P7) for CLI processes that
// grade or accept patches. ORCH's `bootstrap/30-injector.ts` is the owner of this registration; the
// CLI loads bootstrap modules before command modules, so when ORCH's factory is registered this
// module does nothing. Until then it registers the same thing: @fiks/injector's startInjector with
// the rule's Domain frozen clock, so `rerecord-head --profile <drift profile>` and the grader's
// upstream chains can start vendor -> injector inside the grading container.
//
// A rule handed over as JSON keeps `transformPath` (a LoadedRule), so it resolves without the
// rule file's directory (the grader writes the container path there).
import { getDomain, listDomains } from '@fiks/domains';
import { startInjector } from '@fiks/injector';
import type { InjectorRule } from '@fiks/interfaces';
import { getInjectorFactory, registerInjectorFactory } from '@fiks/vendor-api';

/** The frozen clock of the rule's domain (the injector's `date` header and transform clock). */
export function ruleClock(rule: InjectorRule): string | undefined {
  return listDomains().some((d) => d.id === rule.domain) ? getDomain(rule.domain).frozenClock : undefined;
}

export const heldoutInjectorFactory = async ({ target, rule }: { target: string; rule: InjectorRule }) => {
  const inj = await startInjector({ target, rule, clock: ruleClock(rule) });
  return { url: inj.url, close: inj.close };
};

/** Registers the factory unless one is registered already. Returns whether this call did it. */
export function ensureInjectorFactory(): boolean {
  if (getInjectorFactory()) return false;
  registerInjectorFactory(heldoutInjectorFactory);
  return true;
}
