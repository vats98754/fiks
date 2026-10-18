#!/usr/bin/env node
// Makes sure the shop-mcp clone exists at .work/shop-mcp with dependencies installed.
// Read-only clone over https works without auth; pushes and PRs go through `gh`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, '.work/shop-mcp');
const repo = process.env.SHOP_MCP_REPO ?? 'vats98754/shop-mcp';
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

if (!existsSync(join(dir, '.git'))) {
  mkdirSync(join(root, '.work'), { recursive: true });
  console.log(`[ensure-shop-mcp] cloning ${repo} into .work/shop-mcp`);
  sh('git', ['clone', `https://github.com/${repo}.git`, dir]);
  // Fetch over https (no auth needed); push over ssh, which `gh` is set up for.
  sh('git', ['remote', 'set-url', '--push', 'origin', `git@github.com:${repo}.git`], dir);
}
const lock = join(dir, 'pnpm-lock.yaml');
const installed = join(dir, 'node_modules/.modules.yaml');
const stale =
  existsSync(lock) && (!existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs);
if (existsSync(join(dir, 'package.json')) && stale) {
  console.log('[ensure-shop-mcp] installing shop-mcp dependencies');
  sh('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace'], dir);
}
