// Process-level F/P and held-out grading on the real clone (.work/realbugs/R10, made by
// node scripts/ensure-realbugs.mjs --id R10). Skipped when the clone is absent.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeldout } from '../heldout/run.ts';
import { R10_ADAPTER } from './adapter.ts';
import { NAMED_PROPERTY, runHarness } from './run.ts';
import { FIKS_ROOT, repoDir } from './server.ts';

const clone = repoDir();
const hasClone = existsSync(join(clone, '.git'));

describe.skipIf(!hasClone)('R10 on the clone', () => {
  it('clone: origin is the private repo only; tags prefix and fix at the pins', () => {
    const remotes = execFileSync('git', ['-C', clone, 'remote', '-v'], { encoding: 'utf8' })
      .trim()
      .split('\n');
    expect(
      remotes.every((l) => /^origin\s+\S*github\.com[/:]vats98754\/rb-r10-servers(\.git)?\s/.test(l)),
    ).toBe(true);
    const rev = (r: string) =>
      execFileSync('git', ['-C', clone, 'rev-parse', `${r}^{commit}`], { encoding: 'utf8' }).trim();
    expect(rev('prefix')).toBe(R10_ADAPTER.prefixSha);
    expect(rev('fix')).toBe(R10_ADAPTER.fixSha);
  });

  it('F on the prefix: every run violates the named read-after-write property, identically', async () => {
    const r = await runHarness({ sha: 'prefix', runs: 3 });
    expect(r.sha).toBe(R10_ADAPTER.prefixSha);
    expect(r.failures).toBe(3);
    expect(r.distinct).toBe(1);
    expect(r.summaries[0]?.violated).toEqual([NAMED_PROPERTY]);
    expect(r.ok).toBe(true);
  });

  it('P on the human fix: every run verifies', async () => {
    const r = await runHarness({ sha: 'fix', runs: 3 });
    expect(r.sha).toBe(R10_ADAPTER.fixSha);
    expect(r.passes).toBe(3);
    expect(r.ok).toBe(true);
  });

  it('the synthesized clean control verifies on both', async () => {
    for (const sha of ['prefix', 'fix']) {
      const r = await runHarness({
        sha,
        runs: 1,
        fixture: join(FIKS_ROOT, R10_ADAPTER.fixtures[2]?.path ?? ''),
        expect: 'pass',
      });
      expect(r.ok, sha).toBe(true);
    }
  });

  it('held-out: prefix incorrect (4 manifestations fail, controls ok), fix correct', async () => {
    const pre = await runHeldout({ sha: 'prefix' });
    expect(pre.correct).toBe(false);
    expect(pre.cases.filter((c) => !c.ok).map((c) => c.id)).toEqual([
      'H1-mixed-batch',
      'H2-two-existing',
      'H3-same-batch-repeat',
      'H4-existing-other-type',
    ]);
    const fix = await runHeldout({ sha: 'fix' });
    expect(fix.correct).toBe(true);
  });
});
