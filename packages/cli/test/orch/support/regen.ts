// Rewrites the ORCH fixtures: `FIKS_WORK_DIR=$(mktemp -d) pnpm tsx packages/cli/test/orch/support/regen.ts`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLEAN_V1, generateCorpus, generateTrace, TRACE_FIXTURES } from './fixtures.ts';

for (const f of TRACE_FIXTURES) {
  writeFileSync(f.file, await generateTrace(f));
  console.log(`wrote ${f.file}`);
}
mkdirSync(CLEAN_V1.dir, { recursive: true });
for (const [name, bytes] of Object.entries(await generateCorpus())) {
  writeFileSync(join(CLEAN_V1.dir, name), bytes);
  console.log(`wrote ${join(CLEAN_V1.dir, name)}`);
}
process.exit(0);
