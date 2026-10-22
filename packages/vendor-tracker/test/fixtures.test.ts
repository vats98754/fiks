// tracker-mcp at the pinned ref: its v1 fixtures are exactly what the recorder writes today
// (vendor v1, original catalog, frozen clock), it ships no contracts, and its CI is unprivileged.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FIXTURE_CALLS, trackerDomain } from '../src/index.ts';
import { recordFixtures } from '../src/record-fixtures.ts';

test('tracker-mcp v1 fixtures regenerate byte-identically', async () => {
  const repo = trackerDomain.repo.dir();
  const out = mkdtempSync(join(tmpdir(), 'fiks-tracker-fixtures-'));
  const written = await recordFixtures(repo, out);
  expect(written).toHaveLength(FIXTURE_CALLS.length);
  const committed = join(repo, 'test/fixtures/v1');
  expect(readdirSync(committed).sort()).toEqual(readdirSync(out).sort());
  for (const f of readdirSync(out)) {
    expect(readFileSync(join(out, f), 'utf8'), f).toBe(readFileSync(join(committed, f), 'utf8'));
  }
});

test('tracker-mcp main: >= 6 tools, no contracts, CI with permissions: contents: read', () => {
  const repo = trackerDomain.repo.dir();
  const tools = readdirSync(join(repo, 'src/tools')).filter((f) => !['handlers.ts', 'schema.ts'].includes(f));
  expect(tools.length).toBeGreaterThanOrEqual(6);
  expect(readdirSync(join(repo, 'test/fiks/vendored')).filter((f) => f.endsWith('.contracts.json'))).toEqual(
    [],
  );
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
  expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
  expect(ci).not.toMatch(/\$\{\{\s*secrets\./);
  for (const f of ['replay.ts', 'run.ts', 'check.ts', 'vendored/evaluate.ts', 'vendored/types.ts']) {
    expect(readdirSync(join(repo, 'test/fiks', f.includes('/') ? 'vendored' : '.')), f).toContain(
      f.split('/').pop(),
    );
  }
});
