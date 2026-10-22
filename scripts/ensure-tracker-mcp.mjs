#!/usr/bin/env node
// Makes sure the tracker-mcp clone exists at .work/tracker-mcp (FIKS_TRACKER_DIR overrides),
// checked out detached at the commit pinned in packages/vendor-tracker/tracker-sync-ref.json, with
// the tags the build needs (dev-tracker-stub; seed-tracker-v1 once it exists) and its dependencies
// installed. It never follows a moving branch, and it refuses a dirty clone. Idempotent: the only
// network steps are the clone itself and one `git fetch --tags` (plus the pinned commit if the
// tags do not bring it) per pinned ref, remembered in the clone's `fiks.fetchedFor`.
// tracker-mcp is private: the clone goes over ssh (TRACKER_MCP_REMOTE overrides, e.g. a local path).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = process.env.FIKS_TRACKER_DIR ?? join(root, '.work/tracker-mcp');
const pin = JSON.parse(readFileSync(join(root, 'packages/vendor-tracker/tracker-sync-ref.json'), 'utf8'));
const repo = process.env.TRACKER_MCP_REPO ?? pin.repo ?? 'vats98754/tracker-mcp';
const remote = process.env.TRACKER_MCP_REMOTE ?? `git@github.com:${repo}.git`;
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
  console.error(`[ensure-tracker-mcp] ${message}`);
  process.exit(1);
};

if (!/^[0-9a-f]{40}$/.test(pin.ref ?? ''))
  fail('packages/vendor-tracker/tracker-sync-ref.json has no 40-hex ref');

if (!existsSync(join(dir, '.git'))) {
  mkdirSync(dirname(dir), { recursive: true });
  console.log(`[ensure-tracker-mcp] cloning ${repo} into ${dir}`);
  sh('git', ['clone', '--quiet', remote, dir]);
}

// Before anything that changes the clone: refuse local edits (they would be checked out over).
const dirty = git('status', '--porcelain');
if (dirty) fail(`${dir} has local changes; refusing to check out ${pin.ref}:\n${dirty}`);

const hasPin = () => ok('cat-file', '-e', `${pin.ref}^{commit}`);
const hasTag = (t) => ok('rev-parse', '--verify', '--quiet', `refs/tags/${t}`);
const required = [...(pin.requiredTags ?? []), ...(pin.tag ? [pin.tag] : [])];
const fetchedFor = ok('config', '--get', 'fiks.fetchedFor') ? git('config', '--get', 'fiks.fetchedFor') : '';
if (fetchedFor !== pin.ref || !hasPin() || !required.every(hasTag)) {
  console.log(
    `[ensure-tracker-mcp] fetching tags for ${pin.tag ?? pin.branch ?? 'the pinned ref'} (${pin.ref.slice(0, 7)})`,
  );
  sh('git', ['fetch', '--quiet', '--tags', 'origin'], dir);
  if (!hasPin()) sh('git', ['fetch', '--quiet', 'origin', pin.ref], dir);
  if (!hasPin()) fail(`${pin.ref} is not on origin (${repo})`);
  const missing = required.filter((t) => !hasTag(t));
  if (missing.length) fail(`tags missing on origin (${repo}): ${missing.join(', ')}`);
  git('config', 'fiks.fetchedFor', pin.ref);
}
if (pin.tag) {
  const tagged = git('rev-parse', `${pin.tag}^{commit}`);
  if (tagged !== pin.ref) fail(`tag ${pin.tag} is ${tagged}, but tracker-sync-ref.json pins ${pin.ref}`);
}

if (git('rev-parse', 'HEAD') !== pin.ref) {
  console.log(
    `[ensure-tracker-mcp] checking out ${pin.tag ?? pin.branch ?? ''} ${pin.ref.slice(0, 7)} (detached)`,
  );
  git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', pin.ref);
}

if (process.env.FIKS_TRACKER_SKIP_INSTALL === '1') process.exit(0); // tests on throwaway clones
const lock = join(dir, 'pnpm-lock.yaml');
const installed = join(dir, 'node_modules/.modules.yaml');
const stale =
  existsSync(lock) && (!existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs);
if (existsSync(join(dir, 'package.json')) && stale) {
  console.log('[ensure-tracker-mcp] installing tracker-mcp dependencies');
  sh('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace'], dir);
}
