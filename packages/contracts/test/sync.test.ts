import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

const root = new URL('../../..', import.meta.url).pathname;

test('shop-mcp vendors byte-identical contracts and evaluator', () => {
  const out = execFileSync('node', ['scripts/sync-contracts.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(out).toMatch(/identical/);
});
