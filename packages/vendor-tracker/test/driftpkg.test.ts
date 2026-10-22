// TRK-DEV-1, the tracker dev DriftPackage (PLAN 5.1): manifest and rule; generated files are
// current; in a local clone of tracker-mcp, dev-tracker-stub is not on main, ref A and ref B pass
// every hidden test and the renamed-id variant, base fails >= 1; the docs were committed before
// the stub contract.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriftPackage } from '@fiks/interfaces';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildTrkDev1 } from '../src/build-trk-dev-1.ts';
import { readDriftPackage, readRule, ruleHash } from '../src/devdrift.ts';
import { clone, DRIFTPKGS, git, type Worktree, worktree } from './support/repo.ts';

const FIKS = new URL('../../../', import.meta.url).pathname;
const PKG = join(DRIFTPKGS, 'TRK-DEV-1.json');
const pkg = readDriftPackage(PKG);
const KEYS: (keyof DriftPackage)[] = [
  'id',
  'domain',
  'base',
  'stratum',
  'ideationFamily',
  'authorSession',
  'injectorRule',
  'hiddenTests',
  'refA',
  'refB',
  'renamedIdVariant',
  'generators',
  'changelog',
];

describe('TRK-DEV-1 manifest', () => {
  test('a full DriftPackage on base dev-tracker-stub with a valid tracker InjectorRule', () => {
    const raw = JSON.parse(readFileSync(PKG, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual([...KEYS].sort());
    expect(pkg).toMatchObject({ id: 'TRK-DEV-1', domain: 'tracker', base: 'dev-tracker-stub' });
    expect(pkg.hiddenTests.length).toBeGreaterThanOrEqual(3);
    for (const p of [
      ...pkg.hiddenTests,
      pkg.refA,
      pkg.refB,
      pkg.renamedIdVariant,
      ...pkg.generators,
      pkg.injectorRule.path,
    ]) {
      expect(existsSync(join(pkg.dir, p)), p).toBe(true);
    }
    const names = (d: string) => readdirSync(join(pkg.dir, d)).sort();
    expect(names(pkg.renamedIdVariant)).toEqual(pkg.hiddenTests.map((p) => p.split('/').pop()).sort());
    const rule = readRule(join(pkg.dir, pkg.injectorRule.path));
    expect(Object.keys(JSON.parse(readFileSync(rule.file, 'utf8'))).sort()).toEqual(
      ['clockFrozen', 'domain', 'hash', 'id', 'match', 'transform'].sort(),
    );
    expect(rule).toMatchObject({ id: 'TRK-DEV-1', domain: 'tracker', clockFrozen: true });
    expect(rule.hash).toBe(ruleHash(rule, rule.transformPath));
    expect(pkg.injectorRule.hash).toBe(rule.hash);
    // packages/injector transforms are self-contained: only `import type`.
    expect(readFileSync(rule.transformPath, 'utf8')).not.toMatch(/^\s*import(?!\s+type\b)/m);
  });

  test('generated files are current (rule hash, hidden tests, renamed-id variant, manifest)', async () => {
    for (const f of await buildTrkDev1()) {
      expect(readFileSync(join(DRIFTPKGS, f.path), 'utf8'), f.path).toBe(f.text);
    }
  });

  test('the renamed-id variant renames every issue key and comment id', () => {
    for (const p of pkg.hiddenTests) {
      const name = p.split('/').pop() as string;
      const renamed = readFileSync(join(pkg.dir, pkg.renamedIdVariant, name), 'utf8');
      expect(
        renamed.match(/\bTRK-\d+/g)?.every((k) => /^TRK-9\d+$/.test(k)),
        name,
      ).toBe(true);
      expect(renamed.match(/\bcm-\d+/g)?.every((k) => /^cm-9\d+$/.test(k)) ?? true, name).toBe(true);
    }
  });

  test('the docs (OpenAPI + prose) were committed before the dev stub contract', () => {
    const log = (p: string) => git(FIKS, 'log', '--format=%H', '--', p).split('\n').filter(Boolean);
    const stub = log('packages/vendor-tracker/fixtures/dev-stub.contracts.json').at(-1);
    expect(stub, 'dev-stub.contracts.json is committed').toBeDefined();
    for (const doc of [
      'packages/vendor-tracker/docs/tracker.md',
      'packages/vendor-tracker/docs/openapi.json',
    ]) {
      const commits = log(doc);
      expect(commits.length, doc).toBeGreaterThan(0);
      for (const c of commits) {
        expect(c, doc).not.toBe(stub);
        expect(
          spawnSync('git', ['merge-base', '--is-ancestor', c, stub as string], { cwd: FIKS }).status,
          doc,
        ).toBe(0);
      }
    }
  });
});

describe('TRK-DEV-1 in a local clone of tracker-mcp', () => {
  const runs: Record<string, Worktree> = {};
  beforeAll(() => {
    for (const k of ['base', 'refA', 'refB']) runs[k] = worktree('dev-tracker-stub');
    execFileSync('git', ['apply', join(pkg.dir, pkg.refA)], { cwd: runs.refA?.dir });
    execFileSync('git', ['apply', join(pkg.dir, pkg.refB)], { cwd: runs.refB?.dir });
  });
  afterAll(() => {
    for (const w of Object.values(runs)) w.remove();
  });

  const hidden = (dir: string, variant: 'hidden' | 'renamed') => {
    const dest = join(dir, 'test/hidden');
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const src =
      variant === 'hidden'
        ? pkg.hiddenTests.map((p) => join(pkg.dir, p))
        : readdirSync(join(pkg.dir, pkg.renamedIdVariant)).map((n) => join(pkg.dir, pkg.renamedIdVariant, n));
    for (const f of src) cpSync(f, join(dest, f.split('/').pop() as string));
    const out = join(mkdtempSync(join(tmpdir(), 'fiks-hidden-')), 'report.json');
    spawnSync(
      join(dir, 'node_modules/.bin/vitest'),
      ['run', '--reporter=json', `--outputFile=${out}`, 'test/hidden'],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );
    const report = JSON.parse(readFileSync(out, 'utf8')) as {
      numPassedTests: number;
      numFailedTests: number;
      numTotalTests: number;
    };
    return report;
  };

  test('dev-tracker-stub is not an ancestor of main (exit 1), and main carries no contracts', () => {
    const repo = clone();
    expect(
      spawnSync('git', ['merge-base', '--is-ancestor', 'dev-tracker-stub', 'main'], { cwd: repo }).status,
    ).toBe(1);
    const pin = JSON.parse(
      readFileSync(join(FIKS, 'packages/vendor-tracker/tracker-sync-ref.json'), 'utf8'),
    ) as { ref: string };
    expect(
      spawnSync('git', ['merge-base', '--is-ancestor', 'dev-tracker-stub', pin.ref], { cwd: repo }).status,
    ).toBe(1);
    expect(git(repo, 'ls-tree', '-r', '--name-only', pin.ref)).not.toMatch(/contracts\.json/);
    // dev-tracker-stub = main + exactly the stub contract, byte for byte.
    expect(git(repo, 'rev-parse', 'dev-tracker-stub^{commit}~1')).toBe(pin.ref);
    expect(git(repo, 'diff', '--name-only', pin.ref, 'dev-tracker-stub^{commit}')).toBe(
      'test/fiks/vendored/tracker-mcp.contracts.json',
    );
    expect(git(repo, 'show', 'dev-tracker-stub:test/fiks/vendored/tracker-mcp.contracts.json')).toBe(
      readFileSync(join(FIKS, 'packages/vendor-tracker/fixtures/dev-stub.contracts.json'), 'utf8').trimEnd(),
    );
  });

  test('base fails >= 1 hidden test; ref A and ref B pass every hidden test and the renamed-id variant', () => {
    const base = hidden(runs.base?.dir as string, 'hidden');
    expect(base.numTotalTests).toBe(pkg.hiddenTests.length);
    expect(base.numFailedTests).toBeGreaterThanOrEqual(1);
    for (const k of ['refA', 'refB']) {
      for (const v of ['hidden', 'renamed'] as const) {
        const r = hidden(runs[k]?.dir as string, v);
        expect(r.numTotalTests, `${k} ${v}`).toBe(pkg.hiddenTests.length);
        expect(r.numFailedTests, `${k} ${v}`).toBe(0);
        expect(r.numPassedTests, `${k} ${v}`).toBe(pkg.hiddenTests.length);
      }
    }
  });

  test("ref A and ref B keep tracker-mcp's own suite green on dev-tracker-stub", () => {
    for (const k of ['refA', 'refB']) {
      const dir = runs[k]?.dir as string;
      rmSync(join(dir, 'test/hidden'), { recursive: true, force: true });
      for (const script of ['typecheck', 'lint', 'test']) {
        const r = spawnSync('pnpm', ['run', '--silent', script], { cwd: dir, encoding: 'utf8' });
        expect(r.status, `${k} ${script}: ${r.stdout}${r.stderr}`).toBe(0);
      }
    }
  });
});
