// Domain hooks for repro generation and the gates (PLAN P8, round 5). The gates run whatever the
// registered Domain supplies; the shop defaults below are the ec241bc behaviour, used when the
// `shop` Domain is not registered (library use without the CLI bootstrap, e.g. unit tests).
import { getDomain, listDomains } from '@fiks/domains';
import type { DomainSuite, ReproEmitter, SuiteRun } from '@fiks/interfaces';
import { runSuite } from './gate.ts';
import { shopReproEmitter } from './generate.ts';

export interface ReproHooks {
  reproEmitter: ReproEmitter;
  suite: DomainSuite;
}

/** `**` = the whole suite. */
export const WHOLE_SUITE: readonly string[] = ['**'];

const reCache = new Map<string, RegExp>();

/** A repo-relative glob (`**`, `*`, `?`) as an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  const hit = reCache.get(glob);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  reCache.set(glob, out);
  return out;
}

export function inScope(file: string, scope: readonly string[] = WHOLE_SUITE): boolean {
  return scope.some((g) => globToRegExp(g).test(file));
}

export const isWholeSuite = (scope: readonly string[]) => scope.length === 1 && scope[0] === '**';

/** The part of a suite run that lies inside `scope` (failures, file results and setup errors). */
export function restrictToScope(run: SuiteRun, scope: readonly string[]): SuiteRun {
  if (isWholeSuite(scope)) return run;
  const errorFile = (e: string) => /^([^:\s]+): /.exec(e)?.[1];
  return {
    ...run,
    failed: run.failed.filter((f) => inScope(f.file, scope)),
    files: run.files.filter((f) => inScope(f.file, scope)),
    suiteErrors: run.suiteErrors.filter((e) => {
      const file = errorFile(e);
      return file === undefined || inScope(file, scope);
    }),
  };
}

/**
 * The shop suite: shop-mcp's whole vitest suite (`node_modules/.bin/vitest --reporter=json
 * --testTimeout=60000`), as at ec241bc. A narrower scope passes its literal path prefixes to
 * vitest as filters, and the gates still judge only the failures inside the scope.
 */
export const shopSuite: DomainSuite = {
  scope: WHOLE_SUITE,
  run(repoDir, scope = WHOLE_SUITE) {
    if (isWholeSuite(scope)) return runSuite(repoDir);
    const filters = scope.map((g) => g.split(/[*?]/)[0] ?? '').filter(Boolean);
    return runSuite(repoDir, { filters });
  },
  oneFailingInScope: (run, scope = WHOLE_SUITE) =>
    run.failed.filter((f) => inScope(f.file, scope)).length === 1,
};

export function shopHooks(): ReproHooks {
  return { reproEmitter: shopReproEmitter, suite: shopSuite };
}

/** The repro hooks of domain `id`: the registered Domain's, else (for `shop` only) the defaults. */
export function reproHooks(id = 'shop'): ReproHooks {
  if (listDomains().some((d) => d.id === id)) return getDomain(id);
  if (id === 'shop') return shopHooks();
  return getDomain(id);
}
