import { describe, expect, it } from 'vitest';
import { detectInDiff } from '../src/ast.ts';
import { addedLines, addedLinesAll } from '../src/diff.ts';

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
});
