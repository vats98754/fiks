// The F gate must reject repro tests that do not fail for the stated reason.
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, failGate, generateRepro, passGate, type Trace } from '@fiks/repro';
import { afterEach, expect, test } from 'vitest';
import { captureTrace } from '../src/commands/repro.ts';
import { shopDir, WORK_DIR } from '../src/paths.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function seedWorktree(name: string) {
  const wt = addWorktree(shopDir(), join(WORK_DIR, 'wt', `neg-${name}-${process.pid}`), 'seed-v1');
  cleanups.push(() => wt.remove());
  return wt.dir;
}

test('negative: a trace whose test passes on unfixed code is rejected', { timeout: 120_000 }, () => {
  const dir = seedWorktree('passes');
  // A healthy v1 recording dressed up as a trace: nothing is actually wrong with it.
  const fixture = join(dir, 'test/fixtures/v1/product-p-1001.json');
  const rec = JSON.parse(readFileSync(fixture, 'utf8'));
  const fake: Trace = {
    ...rec,
    id: 'tr_fakefake00',
    runId: 'neg',
    contractId: 'shop.get_product',
    violated: [
      {
        propertyId: 'shop.get_product/price.notNull',
        kind: 'notNull',
        path: 'price',
        expected: '',
        actual: null,
        message: '',
      },
    ],
    target: ['shop.get_product/price.notNull'],
    server: { name: 'shop-mcp', transport: 'stdio' },
  };
  const file = join(dir, 'fake-trace.json');
  writeFileSync(file, JSON.stringify(fake));
  const g = failGate(dir, generateRepro(fake, file, dir), 1);
  expect(g.ok).toBe(false);
  expect(g.reason).toBe('passed on unfixed code');
});

test('negative: a tampered recording fails for the wrong reason and is rejected', {
  timeout: 120_000,
}, async () => {
  const { file, trace } = await captureTrace('D2', 'neg');
  const tampered: Trace = JSON.parse(JSON.stringify(trace));
  const first = tampered.http[0];
  if (first) first.request.url = '/products/p-9999';
  const dir = seedWorktree('tampered');
  const tamperedFile = join(dir, 'tampered.json');
  writeFileSync(tamperedFile, JSON.stringify(tampered));
  const g = failGate(dir, generateRepro(tampered, tamperedFile, dir), 1);
  expect(g.ok).toBe(false);
  expect(g.reason).toMatch(/wrong failure reason: UNMATCHED_REQUEST/);
  copyFileSync(file, file); // the original trace is untouched
});

test('negative: a trace from a partial v2 profile cannot be stored in shop-mcp', {
  timeout: 120_000,
}, async () => {
  const { trace, file } = await captureTrace('D2', 'neg');
  const partial: Trace = { ...trace, upstream: { version: 'v2', drifts: ['D2'] } };
  const dir = seedWorktree('partial');
  expect(() => generateRepro(partial, file, dir)).toThrow(/partial v2 profile/);
});

function variant(trace: Trace, change: (t: Trace) => void): Trace {
  const t: Trace = JSON.parse(JSON.stringify(trace));
  change(t);
  return t;
}

test('negative: a target that is never evaluated is the wrong reason', { timeout: 120_000 }, async () => {
  const { trace } = await captureTrace('D2', 'neg');
  // p-9999 is not a known-good id, so price.notNull is never checked.
  const t = variant(trace, (x) => {
    x.args = { id: 'p-9999' };
    for (const e of x.http) {
      e.request.url = '/products/p-9999';
      e.response.body = e.response.body.replace(/p-1001/g, 'p-9999');
    }
  });
  const dir = seedWorktree('noteval');
  const f = join(dir, 't.json');
  writeFileSync(f, JSON.stringify(t));
  const g = failGate(dir, generateRepro(t, f, dir), 1);
  expect(g.ok).toBe(false);
  expect(g.reason).toMatch(/wrong failure reason: AssertionError: target properties were not evaluated/);
});

test('negative: a tampered upstream response (500) is the wrong reason', { timeout: 120_000 }, async () => {
  const { trace } = await captureTrace('D2', 'neg');
  const t = variant(trace, (x) => {
    const first = x.http[0];
    if (first) {
      first.response.status = 500;
      first.response.body = '{"error":"boom"}';
    }
  });
  const dir = seedWorktree('500');
  const f = join(dir, 't.json');
  writeFileSync(f, JSON.stringify(t));
  const g = failGate(dir, generateRepro(t, f, dir), 1);
  expect(g.ok).toBe(false);
  expect(g.reason).toMatch(/wrong failure reason/);
});

test('negative: the P gate fails when the repro test is deleted or skipped', {
  timeout: 180_000,
}, async () => {
  const { file, trace } = await captureTrace('D2', 'neg');
  const dir = seedWorktree('pgate');
  const spec = generateRepro(trace, file, dir);
  const testFile = join(dir, spec.testPath);
  const src = readFileSync(testFile, 'utf8');
  writeFileSync(testFile, src.replace("test('", "test.skip('"));
  const skipped = passGate(dir, spec);
  expect(skipped.ok).toBe(false);
  expect(skipped.reason).toMatch(/repro test did not run and pass \(skipped\)/);
  rmSync(testFile);
  const deleted = passGate(dir, spec);
  expect(deleted.ok).toBe(false);
  expect(deleted.reason).toMatch(/repro test did not run and pass \(missing\)/);
});

test('negative: a trace with no target cannot become a repro', { timeout: 120_000 }, async () => {
  const { trace, file } = await captureTrace('D2', 'neg');
  const dir = seedWorktree('notarget');
  expect(() => generateRepro({ ...trace, target: [] }, file, dir)).toThrow(/no target property/);
  expect(() => generateRepro({ ...trace, target: ['shop.get_product/price.range'] }, file, dir)).toThrow(
    /was not violated/,
  );
});
