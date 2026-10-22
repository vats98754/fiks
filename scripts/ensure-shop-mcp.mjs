#!/usr/bin/env node
// Makes sure the shop-mcp clone exists at .work/shop-mcp (FIKS_SHOP_DIR overrides), checked out
// detached at the pinned commit recorded in packages/contracts/shop-sync-ref.json, with its
// dependencies installed. It never follows a moving branch, and it refuses a dirty clone.
// The only network steps: the clone itself, and one `git fetch --tags` (plus the pinned commit
// if the tags do not bring it) per pinned ref, remembered in the clone's `fiks.fetchedFor`.
// Read-only clone over https works without auth; pushes and PRs go through `gh`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = process.env.FIKS_SHOP_DIR ?? join(root, '.work/shop-mcp');
const repo = process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp';
const pin = JSON.parse(readFileSync(join(root, 'packages/contracts/shop-sync-ref.json'), 'utf8'));
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
const ok = (...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};
const fail = (message) => {
  console.error(`[ensure-shop-mcp] ${message}`);
  process.exit(1);
};

if (!/^[0-9a-f]{40}$/.test(pin.ref ?? '')) fail('packages/contracts/shop-sync-ref.json has no 40-hex ref');

if (!existsSync(join(dir, '.git'))) {
  mkdirSync(dirname(dir), { recursive: true });
  console.log(`[ensure-shop-mcp] cloning ${repo} into ${dir}`);
  sh('git', ['clone', `https://github.com/${repo}.git`, dir]);
  // Fetch over https (no auth needed); push over ssh, which `gh` is set up for.
  sh('git', ['remote', 'set-url', '--push', 'origin', `git@github.com:${repo}.git`], dir);
}

// Before anything that changes the clone: refuse local edits (they would be checked out over).
const dirty = git('status', '--porcelain');
if (dirty) fail(`${dir} has local changes; refusing to check out ${pin.ref}:\n${dirty}`);

const hasPin = () => ok('cat-file', '-e', `${pin.ref}^{commit}`);
const fetchedFor = ok('config', '--get', 'fiks.fetchedFor') ? git('config', '--get', 'fiks.fetchedFor') : '';
if (fetchedFor !== pin.ref || !hasPin()) {
  console.log(`[ensure-shop-mcp] fetching tags for ${pin.tag ?? 'the pinned ref'} (${pin.ref.slice(0, 7)})`);
  // --force: a tag that moved on origin (base-shop re-pinned) replaces the stale local one; the
  // peel check below still refuses a tag that disagrees with the pin.
  sh('git', ['fetch', '--quiet', '--tags', '--force', 'origin'], dir);
  if (!hasPin()) sh('git', ['fetch', '--quiet', 'origin', pin.ref], dir);
  if (!hasPin()) fail(`${pin.ref} is not on origin (${repo})`);
  git('config', 'fiks.fetchedFor', pin.ref);
}
if (pin.tag && ok('rev-parse', '--verify', '--quiet', `refs/tags/${pin.tag}`)) {
  const tagged = git('rev-parse', `${pin.tag}^{commit}`);
  if (tagged !== pin.ref) fail(`tag ${pin.tag} is ${tagged}, but shop-sync-ref.json pins ${pin.ref}`);
}

if (git('rev-parse', 'HEAD') !== pin.ref) {
  console.log(`[ensure-shop-mcp] checking out ${pin.tag ?? ''} ${pin.ref.slice(0, 7)} (detached)`);
  git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', pin.ref);
}

if (process.env.FIKS_SHOP_SKIP_INSTALL === '1') process.exit(0); // tests on throwaway clones
const lock = join(dir, 'pnpm-lock.yaml');
const installed = join(dir, 'node_modules/.modules.yaml');
const stale =
  existsSync(lock) && (!existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs);
if (existsSync(join(dir, 'package.json')) && stale) {
  console.log('[ensure-shop-mcp] installing shop-mcp dependencies');
  sh('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace'], dir);
}
