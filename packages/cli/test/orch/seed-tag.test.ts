// `fiks seed-tag --domain tracker`: the dry run lists the vendored files and the target tag; a real
// run (on a temp clone) re-vendors the evaluator with `disabled` support and the contract a
// scripts/contract-disable.mjs call disabled a property of, then tags it. A planted call that
// violates the disabled property leaves the vendored test/fiks check green (it is red with the
// clone's old evaluator), its receipt lists the property under disabled[], and ciLocal on the
// clone is green. The ciLocal part needs Docker (FIKS_ORCH_E2E=1).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ContractFile, evaluate, findContract, type Recording } from '@fiks/contracts';
import { makeReceipt } from '@fiks/proxy';
import { buildRepoImage, ciLocal } from '@fiks/sandbox';
import { describe, expect, test } from 'vitest';
import { VENDOR_HEADER } from '../../src/commands/seed-tag.ts';
import { ROOT, repoDir } from '../../src/paths.ts';
import { E2E, fiks } from './support/arm.ts';
import { ORCH_FIXTURES } from './support/gen.ts';

const PROP = 'tracker.list_comments/countMatchesTotal';
const VENDORED = 'test/fiks/vendored/tracker-mcp.contracts.json';
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8' }).trim();

function tempClone(): string {
  const src = repoDir('tracker');
  const dir = join(mkdtempSync(join(tmpdir(), 'fiks-seedtag-')), 'tracker-mcp');
  execFileSync('git', ['clone', '-q', '--no-hardlinks', src, dir]);
  git(dir, 'checkout', '-q', '--detach', 'dev-tracker-stub');
  symlinkSync(join(src, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

describe('seed-tag', () => {
  test('--dry-run lists the vendored files and the target tag, and changes nothing', () => {
    const clone = tempClone();
    const before = git(clone, 'tag', '--list');
    const r = fiks(['seed-tag', '--domain', 'tracker', '--repo', clone, '--dry-run', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as { tag: string; files: { path: string }[]; dryRun: boolean };
    expect(plan.dryRun).toBe(true);
    expect(plan.tag).toBe('seed-tracker-v1');
    expect(plan.files.map((f) => f.path)).toEqual([
      'test/fiks/vendored/types.ts',
      'test/fiks/vendored/evaluate.ts',
      VENDORED,
    ]);
    expect(git(clone, 'tag', '--list')).toBe(before);
    expect(git(clone, 'status', '--porcelain', '--untracked-files=no')).toBe('');
    const text = fiks(['seed-tag', '--domain', 'tracker', '--repo', clone, '--dry-run']);
    expect(text.stdout).toMatch(/would tag seed-tracker-v1/);
    expect(text.stdout).toMatch(/test\/fiks\/vendored\/evaluate\.ts/);
  }, 120_000);

  test.runIf(E2E)(
    'a property disabled at A0 is re-vendored with the evaluator: planted violation stays green, receipt disabled[], ciLocal green',
    async () => {
      const clone = tempClone();
      const d11 = join(mkdtempSync(join(tmpdir(), 'fiks-d11-')), 'd11.jsonl');
      const dis = spawnSync(
        'node',
        [
          join(ROOT, 'scripts/contract-disable.mjs'),
          '--contracts',
          join(clone, VENDORED),
          '--ids',
          PROP,
          '--reason',
          'ORCH test: disabled at A0',
          '--log',
          d11,
        ],
        { encoding: 'utf8' },
      );
      expect(dis.status, dis.stderr).toBe(0);

      const r = fiks(['seed-tag', '--domain', 'tracker', '--repo', clone, '--tag', 't-test']);
      expect(r.status, r.stderr).toBe(0);
      expect(fiks(['seed-tag', '--domain', 'tracker', '--repo', clone, '--tag', 't-test']).status).toBe(2);
      const evaluateTs = git(clone, 'show', 't-test:test/fiks/vendored/evaluate.ts');
      expect(`${evaluateTs}\n`).toBe(
        VENDOR_HEADER + readFileSync(join(ROOT, 'packages/contracts/src/evaluate.ts'), 'utf8'),
      );
      expect(evaluateTs).toMatch(/disabled/);
      const contracts = JSON.parse(git(clone, 'show', `t-test:${VENDORED}`)) as ContractFile;
      const inv = findContract(contracts, 'list_comments')?.invariants?.find(
        (i) => i.id === 'countMatchesTotal',
      ) as {
        disabled?: boolean;
      };
      expect(inv.disabled).toBe(true);

      // The planted call: TRK-DEV-1's frozen call violates countMatchesTotal (items [] vs total 3).
      const trace = join(ORCH_FIXTURES, 'TRK-DEV-1.trace.json');
      const plant = 'test/fixtures/v1/zz-planted-disabled.json';
      const vitest = (dir: string) =>
        spawnSync(join(dir, 'node_modules/.bin/vitest'), ['run', 'test/fiks'], {
          cwd: dir,
          encoding: 'utf8',
        });
      // Control: the clone's old evaluator ignores `disabled`, so the same plant is red there.
      const old = join(mkdtempSync(join(tmpdir(), 'fiks-seedtag-old-')), 'wt');
      git(clone, 'worktree', 'add', '-q', '--detach', old, 'dev-tracker-stub');
      symlinkSync(join(repoDir('tracker'), 'node_modules'), join(old, 'node_modules'));
      copyFileSync(join(clone, VENDORED), join(old, VENDORED));
      copyFileSync(trace, join(old, plant));
      expect(vitest(old).status).not.toBe(0);

      const wt = join(mkdtempSync(join(tmpdir(), 'fiks-seedtag-wt-')), 'wt');
      git(clone, 'worktree', 'add', '-q', '--detach', wt, 't-test');
      symlinkSync(join(repoDir('tracker'), 'node_modules'), join(wt, 'node_modules'));
      copyFileSync(trace, join(wt, plant));
      const green = vitest(wt);
      expect(green.status, `${green.stdout}\n${green.stderr}`.slice(-3000)).toBe(0);

      const rec = JSON.parse(readFileSync(trace, 'utf8')) as Recording;
      const res = evaluate(findContract(contracts, rec.tool), {
        args: rec.args,
        result: rec.result as NonNullable<Recording['result']>,
        now: new Date(rec.capturedAt),
        upstream: rec.http,
      });
      const receipt = makeReceipt(res, new Date(rec.capturedAt), true);
      expect(receipt.disabled).toContain(PROP);
      expect(receipt.checked).not.toContain(PROP);
      expect(receipt.violations.map((v) => v.propertyId)).not.toContain(PROP);

      const image = (await buildRepoImage({ repo: clone, ref: 't-test' })).digest;
      const ci = await ciLocal(wt, image);
      expect(ci.green, ci.log.slice(-4000)).toBe(true);
    },
    30 * 60_000,
  );
});
