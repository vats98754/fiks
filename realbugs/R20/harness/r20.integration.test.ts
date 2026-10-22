// Process-level F/P and held-out grading on the real clone (.work/realbugs/R20, made by
// node scripts/ensure-realbugs.mjs --id R20), in the SBX sandbox. Skipped when the clone or Docker
// is absent.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeldout } from '../heldout/run.ts';
import { R20_ADAPTER } from './adapter.ts';
import { repoDir } from './paths.ts';
import { NAMED_PROPERTY, runHarness } from './run.ts';

const clone = repoDir();
const hasClone = existsSync(join(clone, '.git'));
const hasDocker =
  spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasClone || !hasDocker)('R20 on the clone (sandboxed)', () => {
  it('clone: origin is the private repo only; tags prefix and fix at the pins', () => {
    const remotes = execFileSync('git', ['-C', clone, 'remote', '-v'], { encoding: 'utf8' })
      .trim()
      .split('\n');
    expect(
      remotes.every((l) =>
        /^origin\s+\S*github\.com[/:]vats98754\/rb-r20-figma-context-mcp(\.git)?\s/.test(l),
      ),
    ).toBe(true);
    const rev = (r: string) =>
      execFileSync('git', ['-C', clone, 'rev-parse', `${r}^{commit}`], { encoding: 'utf8' }).trim();
    expect(rev('prefix')).toBe(R20_ADAPTER.prefixSha);
    expect(rev('fix')).toBe(R20_ADAPTER.fixSha);
  });

  it('F on the prefix: every run violates the named filesystem postcondition, identically', async () => {
    const r = await runHarness({ sha: 'prefix', runs: 3 });
    expect(r.sha).toBe(R20_ADAPTER.prefixSha);
    expect(r.failures).toBe(3);
    expect(r.distinct).toBe(1);
    expect(r.replayProblems).toEqual([]);
    expect(r.summaries[0]?.violated).toEqual([NAMED_PROPERTY, NAMED_PROPERTY]);
    expect(r.ok).toBe(true);
  });

  it('P on the human fix: every run verifies, with a clean replay', async () => {
    const r = await runHarness({ sha: 'fix', runs: 3 });
    expect(r.sha).toBe(R20_ADAPTER.fixSha);
    expect(r.passes).toBe(3);
    expect(r.verified).toBe(3);
    expect(r.replayProblems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('held-out: the prefix is incorrect and the human fix is correct, with no contract fire on the fix', async () => {
    const p = await runHeldout({ sha: 'prefix' });
    expect(p.correct).toBe(false);
    const f = await runHeldout({ sha: 'fix' });
    expect(f.correct).toBe(true);
    expect(f.cases.every((c) => c.contract !== 'violated')).toBe(true);
    // The contract fires exactly where the held-out oracle fails the prefix.
    expect(p.cases.filter((c) => !c.ok).map((c) => c.id)).toEqual(
      p.cases.filter((c) => c.contract === 'violated').map((c) => c.id),
    );
  });
});
