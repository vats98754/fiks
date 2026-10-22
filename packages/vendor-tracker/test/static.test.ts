// truth() and originEntity() never depend on the contracts, the proxy or any monitor (PLAN 3.0,
// 3.1): neither file nor any local module they import (transitively) names those packages.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';

const SRC = new URL('../src/', import.meta.url).pathname;
const FORBIDDEN = /@fiks\/(contracts|proxy)|packages\/(contracts|proxy)\//;

function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const text = readFileSync(entry, 'utf8');
  for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1] as string;
    if (spec.endsWith('.ts')) closure(resolve(dirname(entry), spec), seen);
  }
  return seen;
}

test.each(['truth.ts', 'originEntity.ts', 'entityClass.ts'])(
  '%s imports no contract, proxy or monitor',
  (file) => {
    const files = [...closure(resolve(SRC, file))];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(FORBIDDEN);
  },
);
