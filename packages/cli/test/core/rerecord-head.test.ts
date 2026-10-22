// `fiks rerecord-head` (PLAN P23) on the D3 and D4 fix heads of shop-mcp main (7c5f4ea, 88ed791)
// and their pre-fix parents (bce692a, 0d0d3b5): stale recordings re-recorded (mode stale), the
// drift's trace copied to .alerts/<id>.json and read by a stub test through test/fiks/run.ts
// replayRecording re-recorded as a per-check overlay (mode overlay) and restored afterwards.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RerecordLog } from '@fiks/interfaces';
import { createWorktree } from '@fiks/repro';
import { afterAll, describe, expect, test } from 'vitest';
import { shopDir } from '../../src/paths.ts';
import { runCli } from './support/cli.ts';

const PROFILE = { domain: 'shop', base: 'v2', ruleId: null, ruleHash: null };
const CASES = [
  {
    drift: 'D3',
    head: '7c5f4ea',
    parent: 'bce692a',
    trace: 'tr_7280855590',
    target: 'shop.create_order/readAfterWrite',
    stale: ['test/fixtures/v1/order-create.json', 'test/repro/tr_7280855590.json'],
  },
  {
    drift: 'D4',
    head: '88ed791',
    parent: '0d0d3b5',
    trace: 'tr_d02358451e',
    target: 'shop.search_products/countMatchesTotal',
    stale: ['test/repro/tr_d02358451e.json'],
  },
];

const tmp = mkdtempSync(join(tmpdir(), 'fiks-rerecord-head-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  log: RerecordLog & { at: string };
  alertBefore: Buffer;
  alertAfter: Buffer;
  stub: { numFailedTests: number; text: string };
  output: string;
}

let n = 0;
function runOn(ref: string, c: (typeof CASES)[number]): Run {
  const wt = createWorktree(shopDir(), ref, { dir: join(tmp, `wt-${n++}`) });
  try {
    // The drift's frozen trace, as an arm's alert: read-only evidence at .alerts/<id>.json.
    mkdirSync(join(wt.dir, '.alerts'));
    const alert = join(wt.dir, '.alerts', `${c.trace}.json`);
    writeFileSync(
      alert,
      execFileSync('git', ['show', `${c.parent}:test/repro/${c.trace}.json`], { cwd: wt.dir }),
    );
    const alertBefore = readFileSync(alert);
    // An agent-style test: loads the alert through the repo's replay helper (no inline copy).
    writeFileSync(
      join(wt.dir, 'test/stub-alert.test.ts'),
      `import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('the alert replays on this head and ${c.target} holds', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/${c.trace}.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.unmatched, 'UNMATCHED_REQUEST').toEqual([]);
  expect(r.evaluation.violations.map((v) => v.propertyId)).not.toContain('${c.target}');
});
`,
    );
    const log = join(wt.dir, '..', `rerecord-${n}.jsonl`);
    const report = join(wt.dir, '..', `stub-${n}.json`);
    const r = runCli([
      'rerecord-head',
      '--worktree',
      wt.dir,
      '--profile',
      JSON.stringify(PROFILE),
      '--from',
      'HEAD',
      '--log',
      log,
      '--check',
      'suite',
      '--',
      'node_modules/.bin/vitest',
      'run',
      'test/stub-alert.test.ts',
      '--reporter=json',
      `--outputFile=${report}`,
    ]);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const stubJson = JSON.parse(readFileSync(report, 'utf8'));
    return {
      status: r.status,
      log: JSON.parse(lines[0] as string),
      alertBefore,
      alertAfter: readFileSync(alert),
      stub: { numFailedTests: stubJson.numFailedTests, text: JSON.stringify(stubJson) },
      output: r.stdout + r.stderr,
    };
  } finally {
    wt.remove();
  }
}

const withoutTimestamps = ({ at: _at, ...rest }: Run['log']) => rest;

describe.each(CASES)('$drift', (c) => {
  test(`fix head ${c.head}: stale + overlay re-recorded, stub passes, alert restored, deterministic log`, () => {
    const first = runOn(c.head, c);
    expect(first.status, first.output).toBe(0);
    expect(first.stub.numFailedTests).toBe(0);
    expect(first.stub.text).not.toContain('UNMATCHED_REQUEST');
    expect(first.alertAfter.equals(first.alertBefore)).toBe(true);
    const log = first.log;
    expect(log.profile).toEqual(PROFILE);
    expect(log.head).toBe(
      execFileSync('git', ['rev-parse', `${c.head}^{commit}`], { cwd: shopDir(), encoding: 'utf8' }).trim(),
    );
    expect(log.fromCommit).toBe(log.head);
    expect(log.check).toBe('suite');
    const stale = log.files.filter((f) => f.mode === 'stale');
    expect(stale.map((f) => f.path).sort()).toEqual([...c.stale].sort());
    const overlay = log.files.filter((f) => f.mode === 'overlay');
    expect(overlay.map((f) => [f.path, f.outcome])).toEqual([[`.alerts/${c.trace}.json`, 'rerecorded']]);
    for (const f of [...stale, ...overlay]) {
      expect(f.outcome).toBe('rerecorded');
      // The head makes upstream requests the recording never saw.
      expect(
        f.requestKeysAfter.some((k) => !f.requestKeysBefore.includes(k)),
        f.path,
      ).toBe(true);
    }
    const second = runOn(c.head, c);
    expect(second.status).toBe(0);
    expect(withoutTimestamps(second.log)).toEqual(withoutTimestamps(first.log));
    expect(JSON.stringify(withoutTimestamps(second.log))).toBe(JSON.stringify(withoutTimestamps(first.log)));
  }, 600_000);

  test(`pre-fix parent ${c.parent}: nothing to overlay, the stub test fails`, () => {
    const r = runOn(c.parent, c);
    expect(r.status).not.toBe(0);
    expect(r.stub.numFailedTests).toBe(1);
    expect(r.stub.text).toContain(c.target);
    expect(r.alertAfter.equals(r.alertBefore)).toBe(true);
    expect(r.log.files.filter((f) => f.mode === 'overlay').map((f) => [f.path, f.outcome])).toEqual([
      [`.alerts/${c.trace}.json`, 'unchanged'],
    ]);
    expect(r.log.files.filter((f) => f.mode === 'stale')).toEqual([]);
  }, 600_000);
});
