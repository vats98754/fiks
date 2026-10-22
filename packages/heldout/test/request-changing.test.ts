// requestChanging (PLAN 3.0): computed from ref A only, by one rerecord-head over the frozen trace
// and the enumeration, through execFiks in the grading container. Here on a scripted sandbox (the
// decision rule and the call); test/e2e.test.ts runs it in real containers on D1-D5.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RerecordLog } from '@fiks/interfaces';
import { FIKS_TSX } from '@fiks/sandbox';
import { describe, expect, test } from 'vitest';
import { loadPackage } from '../src/pkg.ts';
import { requestChanging } from '../src/request-changing.ts';
import { type ExecCall, scriptedSandbox } from './support/fake-sandbox.ts';
import { DEV, manifestOf, requireShop } from './support/shop.ts';

async function run(id: string, changed: (path: string) => boolean) {
  const p = await loadPackage(manifestOf(id));
  const dir = join(DEV, id);
  const bytes = readFileSync(join(dir, 'trace.json'), 'utf8');
  const calls: ExecCall[] = [];
  const sandbox = scriptedSandbox(
    {
      rerecord: (argv) => {
        const recs = (argv[argv.indexOf('--recordings') + 1] ?? '').split(',');
        const log: RerecordLog = {
          profile: JSON.parse(argv[argv.indexOf('--profile') + 1] as string),
          head: 'h',
          fromCommit: 'f',
          check: 'accept',
          files: [
            // A stale suite fixture never counts: only the trace and the enumeration do.
            {
              path: 'test/fixtures/v1/order-create.json',
              mode: 'stale',
              requestKeysBefore: [],
              requestKeysAfter: [],
              outcome: 'rerecorded',
            },
            ...recs.map((path) => ({
              path,
              mode: 'overlay' as const,
              requestKeysBefore: ['a'],
              requestKeysAfter: changed(path) ? ['a', 'b'] : ['a'],
              outcome: changed(path) ? ('rerecorded' as const) : ('unchanged' as const),
            })),
          ],
        };
        return { code: 0, log };
      },
    },
    calls,
  );
  const r = await requestChanging(p, {
    repoDir: requireShop(),
    sandbox,
    trace: { id: (JSON.parse(bytes) as { id: string }).id, bytes },
    enumeration: readdirSync(join(dir, 'enum'))
      .sort()
      .map((f) => join(dir, 'enum', f)),
  });
  return { r, calls };
}

describe('requestChanging', () => {
  test('true iff an overlaid trace or enumeration recording was re-recorded; stale fixtures do not count', async () => {
    const { r, calls } = await run('D3', (p) => p.startsWith('.alerts/'));
    expect(r.requestChanging).toBe(true);
    expect(r.rerecorded).toHaveLength(1);
    const rr = calls.filter(
      (c) => c.cmd === FIKS_TSX && c.args[1] === 'rerecord-head' && !c.args.includes('--restore'),
    );
    expect(rr).toHaveLength(1);
    expect(rr[0]?.args).toContain('--require-sandbox');
    const named = (rr[0]?.args[rr[0].args.indexOf('--recordings') + 1] ?? '').split(',');
    expect(named.filter((n) => n.startsWith('.fiks-enum/'))).toHaveLength(
      readdirSync(join(DEV, 'D3/enum')).length,
    );
    expect(named.filter((n) => n.startsWith('.alerts/'))).toHaveLength(1);
    const none = await run('D1', () => false);
    expect(none.r.requestChanging).toBe(false);
  }, 120_000);
});
