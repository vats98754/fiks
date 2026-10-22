#!/usr/bin/env node
// Installs the pinned oasdiff release (PLAN 8.0-4, approved install) into
// $HOME/.fiks/tools/oasdiff-<version>/oasdiff, verifying the archive's sha256 against the value
// pinned below (taken from the release's own asset digests). Idempotent; never touches PATH.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const VERSION = '1.33.0'; // released 2026-10-01 (>= 14 days before the build)
const ASSETS = {
  'darwin-arm64': ['darwin_all', '2a479337c15afdcbf0b1e89c0b4d0cf0176472dbc11483358fed1f831d1e46c5'],
  'darwin-x64': ['darwin_all', '2a479337c15afdcbf0b1e89c0b4d0cf0176472dbc11483358fed1f831d1e46c5'],
  'linux-x64': ['linux_amd64', '43a4e328e2d13ba1552d760aa68d2485c75c5621f309f6ff64ae895188345247'],
  'linux-arm64': ['linux_arm64', '4ae3c362d6074d919aada2dea82d0ee84366591600384455d0bdc658ddf8f7ae'],
};

const dest = join(homedir(), '.fiks/tools', `oasdiff-${VERSION}`);
const bin = join(dest, 'oasdiff');
if (existsSync(bin)) {
  console.log(`[ensure-oasdiff] ${bin} present`);
  process.exit(0);
}
const asset = ASSETS[`${process.platform}-${process.arch}`];
if (!asset) {
  console.error(`[ensure-oasdiff] no pinned asset for ${process.platform}-${process.arch}`);
  process.exit(2);
}
const [suffix, sha256] = asset;
const name = `oasdiff_${VERSION}_${suffix}.tar.gz`;
const url = `https://github.com/oasdiff/oasdiff/releases/download/v${VERSION}/${name}`;
console.log(`[ensure-oasdiff] downloading ${url}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`[ensure-oasdiff] HTTP ${res.status} for ${url}`);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
const got = createHash('sha256').update(bytes).digest('hex');
if (got !== sha256) {
  console.error(`[ensure-oasdiff] sha256 mismatch for ${name}: got ${got}, pinned ${sha256}`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'fiks-oasdiff-dl-'));
try {
  const archive = join(work, name);
  writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', work, 'oasdiff']);
  mkdirSync(dest, { recursive: true });
  chmodSync(join(work, 'oasdiff'), 0o755);
  renameSync(join(work, 'oasdiff'), bin);
  writeFileSync(join(dest, 'SOURCE'), `${url}\nsha256 ${sha256}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`[ensure-oasdiff] installed ${bin}`);
