import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertCleanTree, DirtyTreeError, dirtyPaths } from '../src/index.ts';
import { tempRepo } from './support/repo.ts';

test('a clean tree passes; run-output folders never count as dirty', () => {
  const dir = tempRepo();
  expect(dirtyPaths(dir)).toEqual([]);
  for (const d of ['bench/results/run1', 'bench/evidence', 'paper/results/raw/R1']) {
    mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, d, 'meta.json'), '{}');
  }
  expect(() => assertCleanTree(dir)).not.toThrow();
});

test('modified and untracked files make the tree dirty', () => {
  const dir = tempRepo();
  writeFileSync(join(dir, 'README.md'), 'changed\n');
  mkdirSync(join(dir, 'packages/x'), { recursive: true });
  writeFileSync(join(dir, 'packages/x/new.ts'), '');
  expect(dirtyPaths(dir)).toEqual([' M README.md', '?? packages/x/new.ts']);
  expect(() => assertCleanTree(dir)).toThrow(DirtyTreeError);
  expect(() => assertCleanTree(dir)).toThrow(/refusing to start: .* uncommitted changes/);
});
