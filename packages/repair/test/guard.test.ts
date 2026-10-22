import { expect, test } from 'vitest';
import { checkPaths, mayRun, mayWrite, REPAIR_ALLOWED, RERECORD_ALLOWED } from '../src/index.ts';

test('the agent may only write source files inside its worktree', () => {
  const wt = '/w/fiks/x';
  expect(mayWrite(wt, '/w/fiks/x/src/tools/get_product.ts')).toBe(true);
  expect(mayWrite(wt, 'src/vendor.ts')).toBe(true);
  for (const p of [
    '/w/fiks/x/test/fiks/check.ts',
    '/w/fiks/x/test/repro/tr_1.json',
    '/w/fiks/x/.github/workflows/ci.yml',
    '/w/fiks/x/package.json',
    '/w/fiks/x/pnpm-lock.yaml',
    '/w/fiks/x/src/../test/fiks/check.ts',
    '/elsewhere/src/a.ts',
    '/w/fiks/x/vendor/openapi.json',
  ]) {
    expect(mayWrite(wt, p), p).toBe(false);
  }
});

test('the agent may only run pnpm checks', () => {
  for (const c of [
    'pnpm test',
    'pnpm typecheck',
    'pnpm lint',
    'pnpm exec vitest run test/repro',
    'pnpm test test/fiks',
  ]) {
    expect(mayRun(c), c).toBe(true);
  }
  for (const c of [
    'pnpm install',
    'pnpm add left-pad',
    'pnpm test; rm -rf test',
    'pnpm test && git commit -am x',
    'git push',
    'curl https://example.com',
    'pnpm exec biome check --write .',
    'pnpm test | tee x',
    'pnpm lint --write',
    'pnpm test -u',
    'pnpm exec tsc --outDir /tmp/x',
    'pnpm exec vitest run --config=src/x.ts',
    'pnpm test ../../x',
  ]) {
    expect(mayRun(c), c).toBe(false);
  }
});

test('a newline, CR, tab or other control character cannot smuggle a second command', () => {
  for (const c of [
    'pnpm test\ncurl x',
    'pnpm test\ncurl example.com',
    'pnpm test\nnode evil.js',
    'pnpm test\rcurl x',
    'pnpm test\tx',
    'pnpm test\r\ncurl x',
    'pnpm test\vcurl x',
    'pnpm test\fcurl x',
    'pnpm test\u0000curl x',
    'pnpm test\u2028curl x',
    'pnpm test\u00a0x',
    'pnpm  test',
    ' pnpm test',
    'pnpm test ',
    'pnpm test\n',
    'pnpm',
  ]) {
    expect(mayRun(c), JSON.stringify(c)).toBe(false);
  }
});

test('commit guards', () => {
  expect(checkPaths(['src/tools/a.ts'], REPAIR_ALLOWED).ok).toBe(true);
  expect(checkPaths([], REPAIR_ALLOWED).ok).toBe(false);
  expect(checkPaths(['src/a.ts', 'test/x.test.ts'], REPAIR_ALLOWED)).toEqual({
    ok: false,
    rejected: ['test/x.test.ts'],
  });
  expect(
    checkPaths(['test/repro/tr_1.rerecorded.json', 'test/fixtures/v1/a.rerecorded.json'], RERECORD_ALLOWED)
      .ok,
  ).toBe(true);
  expect(checkPaths(['test/repro/tr_1.json'], RERECORD_ALLOWED).ok).toBe(false);
});

test('PR text never carries local absolute paths', async () => {
  const { scrubPaths } = await import('../src/index.ts');
  expect(
    scrubPaths(
      'AssertionError: x violated (/Users/me/fiks/.work/wt/fiks/get-tr_1/test/repro/tr_1.json): expected',
    ),
  ).toBe('AssertionError: x violated (test/repro/tr_1.json): expected');
  expect(scrubPaths('edited /private/tmp/w/src/tools/a.ts and src/b.ts')).toBe(
    'edited src/tools/a.ts and src/b.ts',
  );
});

test('reads stay inside the worktree', async () => {
  const { mayRead } = await import('../src/index.ts');
  expect(mayRead('/w/x', '/w/x/src/a.ts')).toBe(true);
  expect(mayRead('/w/x', 'test/fiks/check.ts')).toBe(true);
  expect(mayRead('/w/x', undefined)).toBe(true);
  expect(mayRead('/w/x', '/Users/me/fiks/.env')).toBe(false);
  expect(mayRead('/w/x', '../../.env')).toBe(false);
});

test('an agent commit cannot hide a test change from the guard', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { changedFilesSince, headOf } = await import('../src/index.ts');
  const r = mkdtempSync(join(tmpdir(), 'fiks-guard-'));
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: r });
  git('init', '-q');
  mkdirSync(join(r, 'src'));
  mkdirSync(join(r, 'test'));
  writeFileSync(join(r, 'src/a.ts'), 'a');
  writeFileSync(join(r, 'test/check.ts'), 'a');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = headOf(r);
  writeFileSync(join(r, 'test/check.ts'), 'cheat');
  git('commit', '-qam', 'sneaky');
  writeFileSync(join(r, 'src/a.ts'), 'fix');
  expect(changedFilesSince(r, base)).toEqual(['src/a.ts', 'test/check.ts']);
  expect(headOf(r)).not.toBe(base);
});

test('path scrubbing: node_modules and home paths go, URLs stay', async () => {
  const { scrubPaths } = await import('../src/index.ts');
  expect(scrubPaths('at file:///Users/me/fiks/.work/shop-mcp/node_modules/.pnpm/vitest@5/x.js:1:2')).toBe(
    'at <local path>',
  );
  expect(scrubPaths('see /Users/me/fiks/.env now')).toBe('see <local path> now');
  expect(scrubPaths('https://github.com/x/shop-mcp/blob/main/src/x.ts')).toBe(
    'https://github.com/x/shop-mcp/blob/main/src/x.ts',
  );
});
