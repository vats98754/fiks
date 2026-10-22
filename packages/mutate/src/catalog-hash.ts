// Prints the operator catalog hash (paper/PLAN.md 5.4, frozen at F1).
//   pnpm tsx packages/mutate/src/catalog-hash.ts           print the hash; exit 1 if catalog.json is stale
//   pnpm tsx packages/mutate/src/catalog-hash.ts --write   recompute implementation hashes and the hash
//   pnpm tsx packages/mutate/src/catalog-hash.ts --json    print {hash, computed, stale} as JSON
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG_PATH, checkCatalog, PACKAGE_DIR, readCatalog, refreshCatalog } from './catalog.ts';

const args = new Set(process.argv.slice(2));
if (args.has('--write')) {
  const next = refreshCatalog(readCatalog());
  writeFileSync(CATALOG_PATH, `${JSON.stringify(next, null, 2)}\n`);
  // Keep the file in the repo's format (the hash is over canonical JSON, so this cannot change it).
  const biome = fileURLToPath(new URL('../../node_modules/.bin/biome', PACKAGE_DIR));
  if (existsSync(biome))
    execFileSync(biome, ['format', '--write', fileURLToPath(CATALOG_PATH)], { stdio: 'ignore' });
  console.log(next.hash);
} else {
  const r = checkCatalog();
  if (args.has('--json'))
    console.log(JSON.stringify({ hash: r.stored, computed: r.computed, stale: r.stale }));
  else console.log(r.ok ? r.stored : `catalog.json is stale (stored ${r.stored}, computed ${r.computed})`);
  if (!r.ok) {
    if (r.stale.length) console.error(`changed since the last --write: ${r.stale.join(', ')}`);
    process.exitCode = 1;
  }
}
