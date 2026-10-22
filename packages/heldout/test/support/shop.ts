// Test helpers: the shop-mcp clone (scripts/ensure-shop-mcp.mjs), the CORE oracle patches and the
// dev DriftPackages.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMGREP_IMAGE } from '../../src/sast/semgrep.ts';

export const FIKS_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const SHOP = join(FIKS_ROOT, '.work', 'shop-mcp');
export const TRACKER = join(FIKS_ROOT, '.work', 'tracker-mcp');
export const ORACLES = join(FIKS_ROOT, 'packages/cli/test/oracles');
export const DEV = join(FIKS_ROOT, 'packages/heldout/fixtures/dev');
export const SHOP_DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
export const manifestOf = (id: string) =>
  id === 'TRK-DEV-1'
    ? join(FIKS_ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json')
    : join(DEV, id, 'manifest.json');

export function requireShop(): string {
  if (!existsSync(join(SHOP, '.git')))
    throw new Error(`${SHOP} is missing: run node scripts/ensure-shop-mcp.mjs`);
  return SHOP;
}

export const gitShow = (repo: string, ref: string, path: string) =>
  execFileSync('git', ['show', `${ref}:${path}`], { cwd: repo, encoding: 'utf8' });

/** Writes `files` under a fresh temp directory. */
export function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-heldout-test-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

/** Docker is up and the pinned Semgrep image is present locally (no pull in tests). */
export function semgrepAvailable(): boolean {
  const info = spawnSync('docker', ['image', 'inspect', SEMGREP_IMAGE.split('@')[0] as string], {
    stdio: 'ignore',
  });
  if (info.status === 0) return true;
  return spawnSync('docker', ['image', 'inspect', SEMGREP_IMAGE], { stdio: 'ignore' }).status === 0;
}
