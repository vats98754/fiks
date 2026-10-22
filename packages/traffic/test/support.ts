// Shared test helpers: the fixture MCP server, a stand-in vendor, throwaway git repos.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerSpec, VendorLike } from '../src/index.ts';

export const FIXTURE = fileURLToPath(new URL('./fixtures/catalog-mcp.mjs', import.meta.url));

export const fixtureServer = (vendorUrl: string): McpServerSpec => ({
  command: process.execPath,
  args: [FIXTURE],
  env: { FIXTURE_BASE_URL: vendorUrl, PATH: process.env.PATH ?? '' },
});

/** A vendor stand-in: counts resets; its URL names the vendor instance. */
export function fakeVendors() {
  const stats = { created: 0, resets: 0, closed: 0 };
  const create = (): VendorLike => {
    const id = ++stats.created;
    return {
      reset: () => {
        stats.resets++;
      },
      listen: async () => `http://127.0.0.1:9/vendor-${id}`,
      close: async () => {
        stats.closed++;
      },
    };
  };
  return { stats, create };
}

export const tempDir = (prefix = 'fiks-traffic-') => mkdtempSync(join(tmpdir(), prefix));

/** A throwaway git repo with one commit (and an optional tag). */
export function tempRepo(tag?: string): string {
  const dir = tempDir('fiks-traffic-repo-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  if (tag) git('tag', tag);
  return dir;
}
