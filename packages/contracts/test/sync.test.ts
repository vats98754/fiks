import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const root = new URL('../../..', import.meta.url).pathname;
/** The peeled commit of shop-mcp's base-shop tag (the re-vendor commit); pretest fetches it. */
const pin = JSON.parse(readFileSync(new URL('../shop-sync-ref.json', import.meta.url), 'utf8')) as {
  tag: string;
  ref: string;
};

test('shop-mcp at the pinned base-shop commit vendors byte-identical contracts and evaluator', () => {
  expect(pin.ref).toMatch(/^[0-9a-f]{40}$/);
  const out = execFileSync('node', ['scripts/sync-contracts.mjs', '--check', '--ref', pin.ref], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(out).toMatch(/identical/);
});
