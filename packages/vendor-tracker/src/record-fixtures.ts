#!/usr/bin/env node
// Writes tracker-mcp's v1 fixtures: every FIXTURE_CALL, in order, in one session against vendor
// v1 (original catalog) under the frozen clock, to <repo>/test/fixtures/v1/<slug>.json.
// usage: tsx packages/vendor-tracker/src/record-fixtures.ts [--repo <tracker-mcp checkout>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { trackerDomain } from './domain.ts';
import { startRecorder } from './record.ts';
import { FIXTURE_CALLS } from './scenarios.ts';

export async function recordFixtures(
  repoDir: string,
  outDir = join(repoDir, 'test/fixtures/v1'),
): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const rec = await startRecorder({
    repoDir,
    serverCommand: trackerDomain.serverCommand,
    clock: trackerDomain.frozenClock,
  });
  const written: string[] = [];
  try {
    for (const c of FIXTURE_CALLS) {
      const r = await rec.call(c.tool, c.args, `v1-${c.slug}`);
      const file = join(outDir, `${c.slug}.json`);
      writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
      written.push(file);
    }
  } finally {
    await rec.close();
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { repo: { type: 'string' } } });
  const files = await recordFixtures(values.repo ?? trackerDomain.repo.dir());
  console.log(`[record-fixtures] wrote ${files.length} fixtures`);
}
