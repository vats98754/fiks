// Export acceptance (PLAN 5.2 item 2): every export kind, built from base-shop and from tracker-mcp
// main, lives outside ~/fiks, its file list equals the manifest, and neither the find nor the grep
// of the acceptance item prints anything. Plus the deny rules and the outside-~/fiks guard.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { denyReason } from '../src/deny.ts';
import {
  buildExport,
  EXPORT_KINDS,
  type ExportManifest,
  listFiles,
  textSource,
  verifyExport,
} from '../src/export.ts';
import { fiks, ROOT } from './support/cli.ts';

const TRACKER_MAIN = (
  JSON.parse(readFileSync(join(ROOT, 'packages/vendor-tracker/tracker-sync-ref.json'), 'utf8')) as {
    ref: string;
  }
).ref;
const ROOTS = [join(homedir(), 'fiks'), join(homedir(), 'fiks-wt'), ROOT].map((p) => realpathSync(p));

const PKG: Record<string, string> = {
  shop: join(ROOT, 'packages/injector/fixtures/driftpkgs/D2.json'),
  tracker: join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json'),
};

/** The acceptance item's find and grep, verbatim. */
function leaks(dir: string): { find: string; grep: string } {
  const find = execFileSync(
    'sh',
    [
      '-c',
      `find "${dir}" \\( -path "*/test/fiks/*" -o -name "*.contracts.json" -o -name evaluate.ts -o -path "*/test/repro/*" -o -path "*/test/traces/*" -o -name .git \\) -print`,
    ],
    { encoding: 'utf8' },
  );
  const g = spawnSync('grep', ['-rlE', 'fiks_receipt|@fiks/|outcome contract', dir], { encoding: 'utf8' });
  return { find: find.trim(), grep: (g.stdout ?? '').trim() };
}

describe('deny list', () => {
  test.each([
    ['test/fiks/check.ts', 'path:test/fiks/**'],
    ['a/test/fiks/vendored/x.json', 'path:test/fiks/**'],
    ['shop-mcp.contracts.json', 'path:*.contracts.json'],
    ['src/evaluate.ts', 'path:evaluate.ts'],
    ['test/repro/tr_1.test.ts', 'path:test/repro/**'],
    ['test/traces/t.json', 'path:test/traces/**'],
    ['.git/config', 'path:.git'],
  ])('%s is denied by path', (p, why) => expect(denyReason(p, 'x')).toBe(why));
  test.each([
    ['x.ts', 'const r = m._meta.fiks_receipt;', 'content:fiks_receipt'],
    ['x.ts', "import type { Domain } from '@fiks/interfaces';", 'content:@fiks/'],
    ['README.md', 'Every result is checked against an Outcome Contract.', 'content:outcome contract'],
  ])('%s is denied by content', (p, text, why) => expect(denyReason(p, text)).toBe(why));
  test('ordinary files pass', () => {
    expect(denyReason('src/tools/get_product.ts', 'export const x = 1;')).toBeNull();
    expect(denyReason('test/server.test.ts', "import { test } from 'vitest';")).toBeNull();
  });
  test('an export inside ~/fiks or this checkout is refused', () => {
    for (const dir of [join(homedir(), 'fiks', 'tmp-export'), join(ROOT, 'tmp-export')]) {
      expect(() =>
        buildExport({ kind: 'catalog', label: 'x', dir, files: [textSource('a.md', 'a')] }),
      ).toThrow(/outside ~\/fiks/);
    }
  });
  test('verifyExport reports extra, changed and denied files', () => {
    const root = mkdtempSync(join(tmpdir(), 'blind-exp-'));
    const e = buildExport({
      kind: 'catalog',
      label: 'v',
      root,
      files: [textSource('a.md', 'a'), textSource('b/c.md', 'c'), textSource('x.contracts.json', '{}')],
    });
    expect(e.manifest.files.map((f) => f.path)).toEqual(['a.md', 'b/c.md']);
    expect(e.manifest.excluded).toEqual([
      { path: 'x.contracts.json', origin: 'generated', reason: 'path:*.contracts.json' },
    ]);
    expect(verifyExport(e.dir, e.manifest)).toEqual([]);
    execFileSync('sh', ['-c', `echo z > "${e.dir}/a.md"; echo y > "${e.dir}/extra.md"`]);
    expect(verifyExport(e.dir, e.manifest).sort()).toEqual(['changed file a.md', 'extra file extra.md']);
  });
});

describe.each([
  ['shop', 'base-shop'],
  ['tracker', TRACKER_MAIN],
])('every export kind from %s at %s', (domain, ref) => {
  const exportRoot = mkdtempSync(join(tmpdir(), `blind-exports-${domain}-`));
  test.each(EXPORT_KINDS.map((k) => [k]))('%s', (kind) => {
    const args = ['author', '--kind', 'export', '--export-kind', kind, '--domain', domain, '--ref', ref];
    if (kind === 'fixer' || kind === 'rater') args.push('--pkg', PKG[domain] as string);
    const r = fiks([...args, '--export-root', exportRoot, '--json']);
    expect(r.code, r.out).toBe(0);
    const out = JSON.parse(r.out.slice(r.out.indexOf('{'))) as { dir: string; manifest: string };
    const dir = realpathSync(out.dir);
    // Outside ~/fiks, ~/fiks-wt and this checkout.
    for (const root of ROOTS) expect(dir.startsWith(`${root}/`), `${dir} under ${root}`).toBe(false);
    const manifest = JSON.parse(readFileSync(out.manifest, 'utf8')) as ExportManifest;
    expect(manifest.kind).toBe(kind);
    // The file list equals the manifest, and nothing denied is inside.
    expect(listFiles(dir)).toEqual(manifest.files.map((f) => f.path));
    expect(verifyExport(dir, manifest)).toEqual([]);
    expect(leaks(dir)).toEqual({ find: '', grep: '' });
    const files = manifest.files.map((f) => f.path);
    if (kind === 'catalog')
      expect(files.sort()).toEqual(['BRIEF.md', ...files.filter((f) => f.startsWith('docs/'))].sort());
    if (kind === 'contract-author') {
      // Exactly docs/** plus 30 recorded original-catalog v1 calls.
      expect(files.every((f) => f.startsWith('docs/') || /^calls\/\d{3}-\w+\.json$/.test(f))).toBe(true);
      expect(files.filter((f) => f.startsWith('calls/'))).toHaveLength(30);
      expect(files.filter((f) => f.startsWith('docs/')).length).toBeGreaterThan(0);
    }
    if (kind === 'contract-llm') {
      expect(files.filter((f) => f.startsWith('calls/'))).toHaveLength(20);
      expect(files.filter((f) => !f.startsWith('calls/'))).toEqual(['tools/tools.json']);
    }
    if (['drift', 'evasive', 'benign', 'fixer'].includes(kind)) {
      expect(files).toContain('src/server.ts');
      expect(files).toContain('blind/BRIEF.md');
      expect(manifest.excluded.some((e) => e.path.startsWith('test/fiks/'))).toBe(true);
    }
  });
});
