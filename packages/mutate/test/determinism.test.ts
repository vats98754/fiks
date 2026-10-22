// Same seed -> identical output hashes, across 3 separate processes and in-process.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { mutateResponse, mutationHash, RESPONSE_OPS } from '../src/index.ts';
import { fingerprint } from './fingerprint.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./fingerprint.ts', import.meta.url));

test('3 runs in separate processes give identical output hashes', { timeout: 60_000 }, () => {
  const runs = [1, 2, 3].map((): string =>
    execFileSync(`${ROOT}node_modules/.bin/tsx`, [SCRIPT], { cwd: ROOT, encoding: 'utf8' }).trim(),
  );
  expect(runs[0]).toMatch(/"all":"[0-9a-f]{64}"/);
  expect(runs[1]).toBe(runs[0]);
  expect(runs[2]).toBe(runs[0]);
  expect(JSON.parse(runs[0] as string)).toEqual(fingerprint());
});

test('different seeds can draw different sites', () => {
  const json = { items: [{ price: 1, stock: 2, weight: 3 }], total: 9, page: 1 };
  const sites = new Set(Array.from({ length: 30 }, (_, i) => mutateResponse('M1', json, i).site));
  expect(sites.size).toBeGreaterThan(1);
});

test('mutationHash is stable for equal inputs within a process', () => {
  const json = { id: 'o-1', created_at: '2026-10-01T12:00:00Z', status: 'confirmed', total: 5 };
  for (const op of RESPONSE_OPS) {
    const a = [1, 2, 3].map(() => mutationHash(mutateResponse(op, json, 'k', { method: 'POST' })));
    expect(new Set(a).size, op).toBe(1);
  }
});
