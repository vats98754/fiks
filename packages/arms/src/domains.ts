// Domain resolution for code that runs outside the fiks CLI loader (the fiks-iv bin): import the
// CLI's bootstrap modules (packages/cli/src/bootstrap/NN-*.ts) in sorted order, as main.ts does,
// so `--domain shop|tracker|rb-<id>` resolves to the same registered Domain objects. Importing a
// module the loader already imported is a no-op (same URL, module cache).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDomain, listDomains } from '@fiks/domains';
import type { Domain } from '@fiks/interfaces';

export const CLI_BOOTSTRAP_DIR = fileURLToPath(new URL('../../cli/src/bootstrap/', import.meta.url));

let loaded: Promise<void> | undefined;

export function loadDomains(): Promise<void> {
  loaded ??= (async () => {
    if (!existsSync(CLI_BOOTSTRAP_DIR)) return;
    const files = readdirSync(CLI_BOOTSTRAP_DIR)
      .filter((f) => /^(?!.*\.d\.ts$)[\w.-]+\.ts$/.test(f))
      .sort();
    for (const f of files) await import(pathToFileURL(join(CLI_BOOTSTRAP_DIR, f)).href);
  })();
  return loaded;
}

/** The registered Domain `id` (after loading the bootstraps); throws, naming the known ids. */
export async function resolveDomain(id: string): Promise<Domain> {
  await loadDomains();
  return getDomain(id);
}

export async function knownDomains(): Promise<string[]> {
  await loadDomains();
  return listDomains().map((d) => d.id);
}
