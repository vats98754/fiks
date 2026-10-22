// A dry-run author on one dev idea (stub llm) produces a DriftPackage with a base field that passes
// `pnpm fiks validate-drift`; validate-drift rejects planted invalid drifts (spec changed, hidden
// tests pass on base under drift, ref A fails a hidden test, nondeterministic injector); the
// dry-run transcripts carry no sentinel string, show settingSources: [], cwd = export dir and no
// web tools, and the author's Bash ran in a `--network none` container.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ruleHash } from '@fiks/injector';
import type { DriftPackage } from '@fiks/interfaces';
import { beforeAll, describe, expect, test } from 'vitest';
import type { ToolLogEntry } from '../src/session.ts';
import { fiks, ROOT, STUBS } from './support/cli.ts';

const ID = 'shop-realistic-000';
let outRoot = '';
let blind = '';
let pkgFile = '';
let dryOut = '';

beforeAll(() => {
  outRoot = mkdtempSync(join(tmpdir(), 'blind-dry-'));
  const r = fiks([
    'author',
    '--kind',
    'drift',
    '--domain',
    'shop',
    '--dry-run',
    '--llm-stub',
    join(STUBS, 'dry-author.ts'),
    '--out-root',
    outRoot,
  ]);
  dryOut = r.out;
  expect(r.code, r.out).toBe(0);
  blind = join(outRoot, '.work/driftbench-blind');
  pkgFile = join(blind, 'drifts', `${ID}.json`);
});

/** A copy of the dry-run package in its own blind dir, edited by `edit`, rule hash recomputed. */
function planted(name: string, edit: (dir: string, pkg: DriftPackage) => DriftPackage | undefined): string {
  const root = mkdtempSync(join(tmpdir(), `blind-planted-${name}-`));
  cpSync(join(blind, 'drifts'), join(root, 'drifts'), { recursive: true });
  const file = join(root, 'drifts', `${ID}.json`);
  const dir = join(root, 'drifts', ID);
  let pkg = JSON.parse(readFileSync(file, 'utf8')) as DriftPackage;
  pkg = edit(dir, pkg) ?? pkg;
  const rulePath = join(dir, 'rule.json');
  const rule = JSON.parse(readFileSync(rulePath, 'utf8'));
  rule.hash = ruleHash(rule, join(dir, rule.transform));
  writeFileSync(rulePath, `${JSON.stringify(rule, null, 2)}\n`);
  writeFileSync(
    file,
    `${JSON.stringify({ ...pkg, injectorRule: { ...pkg.injectorRule, hash: rule.hash } }, null, 2)}\n`,
  );
  return file;
}

const validate = (file: string) => fiks(['validate-drift', file]);
const failed = (out: string) => [...out.matchAll(/^\s+FAIL (\S+):/gm)].map((m) => m[1]);

describe('dry-run author', () => {
  test('produces a complete DriftPackage on base-shop (ref A, independent ref B, rating) that passes validate-drift', () => {
    expect(dryOut).toMatch(new RegExp(`kept 1: ${ID}`));
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as DriftPackage;
    expect(pkg).toMatchObject({
      id: ID,
      domain: 'shop',
      base: 'base-shop',
      stratum: 'realistic',
      ideationFamily: 'opus',
    });
    expect(pkg.hiddenTests).toHaveLength(3);
    expect(pkg.refA).toBe(`${ID}/refA.patch`);
    expect(pkg.refB).toBe(`${ID}/refB.patch`);
    expect(readFileSync(join(blind, 'drifts', pkg.refA), 'utf8')).not.toBe(
      readFileSync(join(blind, 'drifts', pkg.refB), 'utf8'),
    );
    const authoring = JSON.parse(readFileSync(join(blind, 'drifts', ID, 'authoring.json'), 'utf8'));
    expect(authoring.baseCommit).toBe(
      execFileSync('git', ['rev-parse', 'base-shop^{commit}'], {
        cwd: join(ROOT, '.work/shop-mcp'),
        encoding: 'utf8',
      }).trim(),
    );
    expect(JSON.parse(readFileSync(join(blind, 'drifts', ID, 'rating.json'), 'utf8'))).toMatchObject({
      score: 4,
      label: 'LLM rating (D6)',
    });
    expect(JSON.parse(readFileSync(join(blind, 'kept.json'), 'utf8'))).toEqual([
      { id: ID, domain: 'shop', stratum: 'realistic', ideationFamily: 'opus' },
    ]);
    const r = validate(pkgFile);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(new RegExp(`VALID ${ID}`));
    for (const check of ['schema', 'base', 'spec', 'determinism', 'base-fails', 'refA', 'refB'])
      expect(r.out).toMatch(new RegExp(`ok   ${check}:`));
    // The injector's own validator agrees (complete manifest, rule hash).
    const inj = execFileSync(
      join(ROOT, 'node_modules/.bin/tsx'),
      [join(ROOT, 'packages/injector/src/validate-rule.ts'), '--complete', pkgFile],
      { encoding: 'utf8' },
    );
    expect(inj).toMatch(/1\/1 valid/);
  });

  test('transcripts: no sentinel string; settingSources [], cwd = export dir, no web tools; Bash in a --network none container', () => {
    const tdir = join(blind, 'transcripts');
    const transcripts = readdirSync(tdir).filter((f) => f.endsWith('.transcript.jsonl'));
    expect(transcripts.sort()).toEqual([
      `${ID}.author.transcript.jsonl`,
      `${ID}.fixer.transcript.jsonl`,
      `${ID}.rater.transcript.jsonl`,
    ]);
    for (const s of ['D3 lost write: create_order returns 200', 'Fiks — self-healing tools for AI agents']) {
      const g = execFileSync('sh', ['-c', `grep -rlF '${s}' "${tdir}" || true`], { encoding: 'utf8' });
      expect(g.trim(), s).toBe('');
    }
    for (const t of transcripts) {
      const lines = readFileSync(join(tdir, t), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const header = lines.find((l) => l.type === 'fiks_session_header');
      const sb = lines.find((l) => l.type === 'blind_sandbox');
      expect(header?.settingSources, t).toEqual([]);
      expect(header?.cwd, t).toBe(sb?.exportDir);
      expect(header?.webTools, t).toBe('excluded');
      expect(header?.disallowedTools, t).toEqual(['WebFetch', 'WebSearch']);
      expect(header?.tools, t).not.toContain('WebFetch');
      expect(header?.tools, t).not.toContain('WebSearch');
      expect(String(sb?.exportDir).startsWith(ROOT), t).toBe(false);
    }
    const author = readFileSync(join(tdir, `${ID}.author.tools.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as ToolLogEntry);
    const bash = author.filter((e) => e.tool === 'Bash');
    expect(bash).toHaveLength(1);
    expect(bash[0]).toMatchObject({ decision: 'allow', bash: { network: 'none', code: 0 } });
    expect(bash[0]?.bash?.outputHead).toMatch(/^1\nEGRESS_DENIED (EAI_AGAIN|ENOTFOUND)/);
    const sb = readFileSync(join(tdir, `${ID}.author.transcript.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .find((l) => l.type === 'blind_sandbox');
    expect(sb.bash).toMatchObject({ backend: 'docker', network: 'none' });
  });
});

describe('validate-drift rejects planted invalid drifts', () => {
  test('spec changed: the rule also rewrites GET /openapi.json', () => {
    const f = planted('spec', (dir) => {
      const rule = JSON.parse(readFileSync(join(dir, 'rule.json'), 'utf8'));
      rule.match.pathPattern = '^/(products/[^/]+|openapi\\.json)$';
      writeFileSync(join(dir, 'rule.json'), JSON.stringify(rule));
      const t = readFileSync(join(dir, 'transform.ts'), 'utf8').replace(
        '  response(_req: unknown, res: Res): Res | undefined {\n',
        "  response(req: { path: string }, res: Res): Res | undefined {\n    if (req.path === '/openapi.json') return { ...res, body: res.body.replace('\"stock\"', '\"quantity_available\"') };\n",
      );
      writeFileSync(join(dir, 'transform.ts'), t);
      return undefined;
    });
    const r = validate(f);
    expect(r.code, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['spec']);
    expect(r.out).toMatch(/GET \/openapi\.json differs under the rule/);
  });

  test('hidden tests pass on base under drift', () => {
    const f = planted('basepass', (dir, pkg) => {
      // Every hidden test is the v1-shape manifestation, which passes on the unfixed base.
      for (const sub of ['hidden', 'hidden-renamed']) {
        const keep = readFileSync(join(dir, sub, 'product-v1-shape.test.ts'), 'utf8');
        for (const n of ['product-in-stock.test.ts', 'product-low-stock.test.ts'])
          writeFileSync(join(dir, sub, n), keep);
      }
      return pkg;
    });
    const r = validate(f);
    expect(r.code, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['base-fails']);
    expect(r.out).toMatch(/0\/3 fail on base/);
  });

  test('ref A fails a hidden test', () => {
    const f = planted('refa', (dir) => {
      // A "fix" that only reads quantity_available when stock is exactly null: drifted bodies still fail.
      const p = readFileSync(join(dir, 'refA.patch'), 'utf8').replace(
        '(p.stock ?? p.quantity_available ?? 0) > 0',
        '(p.stock === null ? (p.quantity_available ?? 0) : (p.stock ?? 0)) > 0',
      );
      writeFileSync(join(dir, 'refA.patch'), p);
      return undefined;
    });
    const r = validate(f);
    expect(r.code, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['refA']);
    expect(r.out).toMatch(/refA: hidden 1\/3 pass/);
  });

  test('nondeterministic injector', () => {
    const f = planted('nondet', (dir) => {
      const t = readFileSync(join(dir, 'transform.ts'), 'utf8').replace(
        'quantity_available: stock }',
        'quantity_available: stock, etag: Math.random().toString(36) }',
      );
      writeFileSync(join(dir, 'transform.ts'), t);
      return undefined;
    });
    const r = validate(f);
    expect(r.code, r.out).toBe(1);
    expect(failed(r.out)).toEqual(['determinism']);
  });
});

// Keep the planted-copy helper honest: an untouched copy validates.
test('an unedited planted copy is still valid', () => {
  const f = planted('copy', () => undefined);
  const r = validate(f);
  expect(r.code, r.out).toBe(0);
  rmSync(join(f, '..', '..'), { recursive: true, force: true });
});
