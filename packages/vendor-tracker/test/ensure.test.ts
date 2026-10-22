// scripts/ensure-tracker-mcp.mjs on throwaway clones (the prepared .work/tracker-mcp clone is the
// remote, so no network): a fresh directory ends detached at the pinned ref with the required tags;
// a second run fetches nothing; a dirty clone is refused and left alone.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { clone, git } from './support/repo.ts';

const root = new URL('../../../', import.meta.url).pathname;
const pin = JSON.parse(readFileSync(join(root, 'packages/vendor-tracker/tracker-sync-ref.json'), 'utf8')) as {
  ref: string;
  requiredTags: string[];
};
const ensure = (dir: string) =>
  spawnSync('node', ['scripts/ensure-tracker-mcp.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FIKS_TRACKER_DIR: dir,
      TRACKER_MCP_REMOTE: clone(),
      FIKS_TRACKER_SKIP_INSTALL: '1',
      GIT_TRACE: '1',
    },
  });
const fetches = (stderr: string) =>
  stderr.split('\n').filter((l) => /git fetch\b/.test(l) && /trace/.test(l));

describe('scripts/ensure-tracker-mcp.mjs', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'fiks-ensure-tracker-')), 'tracker-mcp');

  test('clones, ends detached at the pinned ref with dev-tracker-stub; the second run fetches nothing', () => {
    const first = ensure(dir);
    expect(first.status, first.stderr).toBe(0);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(pin.ref);
    expect(git(dir, 'branch', '--show-current')).toBe('');
    for (const t of pin.requiredTags) expect(git(dir, 'tag', '--list', t)).toBe(t);
    expect(pin.requiredTags).toContain('dev-tracker-stub');
    const second = ensure(dir);
    expect(second.status, second.stderr).toBe(0);
    expect(fetches(second.stderr)).toEqual([]);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(pin.ref);
  });

  test('a dirty clone: exits non-zero and changes nothing', () => {
    git(dir, 'checkout', '--quiet', 'main');
    const head = git(dir, 'rev-parse', 'HEAD');
    const readme = join(dir, 'README.md');
    const edited = `${readFileSync(readme, 'utf8')}\nlocal edit\n`;
    writeFileSync(readme, edited);
    const r = ensure(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/local changes/);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(readme, 'utf8')).toBe(edited);
  });
});
