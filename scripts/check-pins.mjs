#!/usr/bin/env node
// Fails if any dependency is not an exact version, or was published after the cutoff
// (14 days before the build date). Checks fiks and the local shop-mcp clone.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;
const CUTOFF = process.env.PIN_CUTOFF ?? '2026-10-04T23:59:59Z';
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function manifests() {
  const out = [join(root, 'package.json')];
  for (const dir of ['packages', 'apps']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const p = join(base, name, 'package.json');
      if (existsSync(p)) out.push(p);
    }
  }
  const shop = join(root, '.work/shop-mcp/package.json');
  if (existsSync(shop)) out.push(shop);
  return out;
}

const pins = new Map(); // "name@version" -> [manifest paths]
const errors = [];
for (const file of manifests()) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (spec.startsWith('workspace:')) continue;
      if (!EXACT.test(spec)) {
        errors.push(`${file.replace(root, '')}: ${name}@${spec} is not an exact version`);
        continue;
      }
      const key = `${name}@${spec}`;
      pins.set(key, [...(pins.get(key) ?? []), file.replace(root, '')]);
    }
  }
}

const times = new Map();
async function publishTime(name) {
  if (!times.has(name)) {
    times.set(
      name,
      run('npm', ['view', name, 'time', '--json'], { maxBuffer: 256 * 1024 * 1024 }).then((r) =>
        JSON.parse(r.stdout),
      ),
    );
  }
  return times.get(name);
}

const rows = await Promise.all(
  [...pins.keys()].sort().map(async (key) => {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    try {
      const published = (await publishTime(name))[version];
      if (!published) return { key, status: 'MISSING', published: '-' };
      return { key, status: published <= CUTOFF ? 'ok' : 'TOO_NEW', published };
    } catch (e) {
      return { key, status: 'LOOKUP_FAILED', published: String(e.message).split('\n')[0] };
    }
  }),
);

for (const r of rows) {
  console.log(`${r.status.padEnd(13)} ${r.key.padEnd(46)} ${r.published}`);
  if (r.status !== 'ok') errors.push(`${r.key}: ${r.status} (cutoff ${CUTOFF})`);
}
if (errors.length) {
  console.error(`\ncheck-pins: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\ncheck-pins: ${rows.length} pins ok (cutoff ${CUTOFF})`);
