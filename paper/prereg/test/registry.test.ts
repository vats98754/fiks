import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { matchesGlob } from '../lib/glob.ts';
import { buildRegistry, type RegistryManifest, registryJson } from '../lib/registry.ts';

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const root = mkdtempSync(join(tmpdir(), 'prereg-registry-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const manifest: RegistryManifest = {
  exclude: ['paper/prereg/REGISTRY.json'],
  groups: [
    { id: 'prereg', why: '', required: true, globs: ['paper/prereg/**'] },
    { id: 'arms', why: '', required: true, globs: ['packages/arms/FIDELITY.md'] },
    { id: 'judges', why: '', required: true, globs: ['packages/baselines/prompts/**'] },
  ],
};

describe('glob', () => {
  it('matches ** at any depth and * within a segment', () => {
    expect(matchesGlob('paper/prereg/PREREG.md', 'paper/prereg/**')).toBe(true);
    expect(matchesGlob('paper/prereg/lib/git.ts', 'paper/prereg/**')).toBe(true);
    expect(matchesGlob('paper/prereg2/x', 'paper/prereg/**')).toBe(false);
    expect(matchesGlob('a/b/node_modules/c', '**/node_modules/**')).toBe(true);
    expect(matchesGlob('packages/x/src/a.ts', 'packages/*/src/*.ts')).toBe(true);
    expect(matchesGlob('packages/x/src/d/a.ts', 'packages/*/src/*.ts')).toBe(false);
  });
});

describe('build-registry on a toy repo', () => {
  g(root, 'init', '-q', '-b', 'main');
  put('paper/prereg/PREREG.md', '# prereg\n');
  put('paper/prereg/lib/x.ts', 'export {};\n');
  put('paper/prereg/REGISTRY.json', '{}\n');
  put('packages/arms/FIDELITY.md', 'fidelity\n');
  put('other/file.txt', 'not registered\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'init');

  it('clean tree: every listed path matches git ls-tree -r HEAD and git hash-object', () => {
    const b = buildRegistry(root, manifest);
    expect(b.rows.map((r) => r.path)).toEqual([
      'packages/arms/FIDELITY.md',
      'paper/prereg/PREREG.md',
      'paper/prereg/lib/x.ts',
    ]);
    for (const r of b.rows) {
      expect(r.status).toBe('match');
      expect(r.gitBlob).toBe(g(root, 'hash-object', r.path));
      expect(r.gitBlob).toBe(g(root, 'rev-parse', `HEAD:${r.path}`));
    }
    expect(b.pending).toEqual(['judges']);
    const doc = JSON.parse(registryJson(b, manifest));
    expect(doc.head).toBe(g(root, 'rev-parse', 'HEAD'));
    expect(doc.entries).toHaveLength(3);
  });

  it('flags modified, untracked and deleted paths', () => {
    put('paper/prereg/PREREG.md', '# prereg changed\n');
    put('paper/prereg/new.md', 'new\n');
    rmSync(join(root, 'packages/arms/FIDELITY.md'));
    const b = buildRegistry(root, manifest);
    const status = Object.fromEntries(b.rows.map((r) => [r.path, r.status]));
    expect(status).toEqual({
      'packages/arms/FIDELITY.md': 'deleted',
      'paper/prereg/PREREG.md': 'modified',
      'paper/prereg/lib/x.ts': 'match',
      'paper/prereg/new.md': 'untracked',
    });
  });
});
