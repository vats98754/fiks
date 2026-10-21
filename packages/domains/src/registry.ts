// Domain registry (PLAN.md P8). Bootstrap modules (`packages/cli/src/bootstrap/NN-*.ts`) register
// domains; commands resolve `--domain <id>` through `getDomain`.
import type { Domain } from '@fiks/interfaces';

// One registry per process, even if this module is loaded twice under different paths.
const KEY = Symbol.for('fiks.domains.registry');
const g = globalThis as { [KEY]?: Map<string, Domain> };
const domains: Map<string, Domain> = g[KEY] ?? new Map();
g[KEY] = domains;

/**
 * Registers a domain. Registering the same object again is a no-op; a different object under an
 * id that is already taken throws, so two bootstrap files can never silently shadow each other.
 */
export function registerDomain(domain: Domain): void {
  const id = domain?.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`registerDomain: invalid domain id ${JSON.stringify(id)} (want [a-z0-9][a-z0-9-]*)`);
  }
  const existing = domains.get(id);
  if (existing === domain) return;
  if (existing) throw new Error(`registerDomain: domain "${id}" is already registered`);
  domains.set(id, domain);
}

/** The registered domain `id`; throws, naming the registered ids, when there is none. */
export function getDomain(id: string): Domain {
  const d = domains.get(id);
  if (d) return d;
  const known = [...domains.keys()].sort();
  throw new Error(
    `unknown domain ${JSON.stringify(id)}; registered: ${
      known.length ? known.join(', ') : '(none; were the cli bootstrap modules loaded?)'
    }`,
  );
}

/** Every registered domain, sorted by id. */
export function listDomains(): Domain[] {
  return [...domains.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
