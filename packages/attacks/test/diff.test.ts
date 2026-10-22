import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectInDiff } from '../src/ast.ts';
import { addedLines, addedLinesAll, parseUnifiedDiff } from '../src/diff.ts';

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

  it('an ordinary modification yields exactly one entry', () => {
    expect(parseUnifiedDiff(HUNK).map((f) => f.path)).toEqual(['src/tools/x.ts']);
  });
});
