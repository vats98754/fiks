// The committed ORCH fixtures regenerate byte-identically (CORE harness + INJ injector + the
// product trace store, under the Domain's frozen clock): DEV-X1 and TRK-DEV-1 frozen traces (from
// their drift packages), BEN-DEV-1 (a benign rule) and the clean v1 corpus.
import './support/arm.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CLEAN_V1, generateCorpus, generateTrace, TRACE_FIXTURES } from './support/fixtures.ts';

describe('ORCH fixtures regenerate byte-identically', () => {
  for (const f of TRACE_FIXTURES) {
    test(basename(f.file), async () => {
      const bytes = await generateTrace(f);
      expect(bytes).toBe(readFileSync(f.file, 'utf8'));
      const t = JSON.parse(bytes) as { profile: { ruleId: string }; target: string[]; violated: unknown[] };
      expect(t.target).toHaveLength(1);
      expect(t.violated.length).toBeGreaterThan(0);
    }, 180_000);
  }

  test('clean-v1/ (shop v1 fixture calls at base-shop as CallRecords)', async () => {
    const files = await generateCorpus();
    expect(Object.keys(files).sort()).toEqual(readdirSync(CLEAN_V1.dir).sort());
    for (const [name, bytes] of Object.entries(files))
      expect(bytes, name).toBe(readFileSync(join(CLEAN_V1.dir, name), 'utf8'));
  }, 180_000);
});
