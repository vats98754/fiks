import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

const root = new URL('../../..', import.meta.url).pathname;
const pin = JSON.parse(readFileSync(new URL('../shop-sync-ref.json', import.meta.url), 'utf8')) as {
  ref: string;
};
/** The shop-mcp clone pretest prepared; throwaway clones of it need no network. */
const source = process.env.FIKS_SHOP_DIR ?? join(root, '.work/shop-mcp');
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
const ensure = (dir: string) =>
  spawnSync('node', ['scripts/ensure-shop-mcp.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FIKS_SHOP_DIR: dir, FIKS_SHOP_SKIP_INSTALL: '1', GIT_TRACE: '1' },
  });
const fetches = (stderr: string) =>
  stderr.split('\n').filter((l) => /git fetch\b/.test(l) && /trace/.test(l));

describe('scripts/ensure-shop-mcp.mjs', () => {
  let clone: string;
  beforeAll(() => {
    clone = join(mkdtempSync(join(tmpdir(), 'fiks-ensure-')), 'shop');
    execFileSync('git', ['clone', '--quiet', '--no-tags', source, clone], { stdio: 'pipe' });
    git(clone, 'checkout', '--quiet', 'main');
  });

  test('a clone on main ends detached at the pinned ref; tags are fetched once, then never', () => {
    expect(git(clone, 'rev-parse', 'HEAD')).not.toBe(pin.ref);
    const first = ensure(clone);
    expect(first.status, first.stderr).toBe(0);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(pin.ref);
    expect(git(clone, 'rev-parse', 'base-shop^{commit}')).toBe(pin.ref);
    expect(fetches(first.stderr).length).toBeGreaterThanOrEqual(1);
    const second = ensure(clone);
    expect(second.status, second.stderr).toBe(0);
    expect(fetches(second.stderr)).toEqual([]);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(pin.ref);
  });

  test('a dirty clone: exits non-zero and changes nothing', () => {
    git(clone, 'checkout', '--quiet', 'main');
    const head = git(clone, 'rev-parse', 'HEAD');
    const readme = join(clone, 'README.md');
    const edited = `${readFileSync(readme, 'utf8')}\nlocal edit\n`;
    writeFileSync(readme, edited);
    const r = ensure(clone);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/local changes/);
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(clone, 'branch', '--show-current')).toBe('main');
    expect(readFileSync(readme, 'utf8')).toBe(edited);
  });
});
