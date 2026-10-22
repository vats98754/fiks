// The byte-copied fixtures match the sha256 recorded in fixtures/README.md.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const DIR = new URL('./fixtures/', import.meta.url);

test('every fixture listed in fixtures/README.md has that sha256', () => {
  const readme = readFileSync(new URL('README.md', DIR), 'utf8');
  const rows = [...readme.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)];
  expect(rows.map((r) => r[1])).toContain('D2-trace.json');
  for (const [, file, sha] of rows) {
    const got = createHash('sha256')
      .update(readFileSync(new URL(file as string, DIR)))
      .digest('hex');
    expect(got, file).toBe(sha);
  }
  expect(rows.find((r) => r[1] === 'D2-trace.json')?.[2]).toBe(
    'b6baf03ea14d2fb6ce8bc7df91a223df63177c8dfc8995f7ab1f87ef9e524d15',
  );
});
