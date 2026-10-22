// Process-level checks on the .work/realbugs/R9 clone (skipped without it). They pin what was
// observed, including the blind contract's false negative on the prefix (see ../ATTRITION.md).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeldout } from '../heldout/run.ts';
import { NAMED_PROPERTY, runHarness } from './run.ts';
import { repoDir } from './server.ts';

const repo = repoDir();
const haveClone = existsSync(join(repo, '.git'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

describe.skipIf(!haveClone)('R9 on the clone', () => {
  it('the clone has exactly one remote, origin = the private vats98754 repo, and both tags', () => {
    expect(git('remote')).toBe('origin');
    expect(git('remote', 'get-url', 'origin')).toBe(
      'https://github.com/vats98754/rb-r9-mcp-server-cloudflare.git',
    );
    expect(git('rev-parse', 'prefix^{commit}')).toBe('db9084730dd45ebb6ac4dd5d3181d189cc96e98d');
    expect(git('rev-parse', 'fix^{commit}')).toBe('7e576219a41e9b1e42187a852996bee29bded0cb');
  });

  it('prefix: the npx 0.2.0 artifact hides the payload, and the blind contract does not fire (FN)', async () => {
    const r = await runHarness({ sha: 'prefix', runs: 3 });
    expect(r.serverKind).toBe('npx-artifact');
    expect(r.failures).toBe(0);
    expect(r.passes).toBe(3);
    expect(r.distinct).toBe(1);
    expect(r.summaries[0]?.checked).toEqual([NAMED_PROPERTY]);
    expect(r.observed).toEqual([
      'content 0 block(s), isError false, structuredContent no, non-standard keys [toolResult]',
    ]);
    expect(r.ok).toBe(false);
  });

  it('PR #469 head: the repo package returns the upstream zones as JSON text', async () => {
    const r = await runHarness({ sha: 'fix', runs: 2, expect: 'pass' });
    expect(r.serverKind).toBe('repo-package');
    expect(r.passes).toBe(2);
    expect(r.summaries[0]?.checked).toEqual(['cloudflare.zones_list/carriesUpstream', NAMED_PROPERTY]);
  });

  it('held-out: the prefix is incorrect on every manifestation, the control passes', async () => {
    const r = await runHeldout({ sha: 'prefix' });
    expect(r.correct).toBe(false);
    for (const row of r.rows) expect(row.ok).toBe(row.role === 'control');
    expect(r.rows.every((row) => row.unmatched === 0)).toBe(true);
  });

  it('held-out: PR #469 head passes every case', async () => {
    const r = await runHeldout({ sha: 'fix' });
    expect(r.rows.filter((row) => !row.ok)).toEqual([]);
    expect(r.correct).toBe(true);
  });
});
