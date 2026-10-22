#!/usr/bin/env node
// Makes sure every real-bug clone exists at .work/realbugs/<id> (paper/PLAN.md 5.10, round 6/7).
// For each realbugs/<id>/pins.json it clones the private vats98754 repository named in `repo`
// (origin = that repo, no upstream remote) if the clone is absent, fetches the pinned SHAs if
// they are missing, and points the local tags `prefix` and `fix` at them. Idempotent: when the
// clone and both SHAs are present it makes no network call. The only network step for real bugs.
//
// usage: node scripts/ensure-realbugs.mjs (--all | --id <id>) [--pins-dir <dir>]
//   --all       every <pins-dir>/<id>/pins.json present (none present: nothing to do)
//   --id        one bug, e.g. R10
//   --pins-dir  where <id>/pins.json live (default realbugs/; also FIKS_REALBUG_PINS_DIR)
// pins.json: {"repo": "vats98754/<name>", "prefixSha": "<40 hex>", "fixSha": "<40 hex>", ...}
//   (`prefix`/`fix` are accepted for the SHAs too). A missing `repo`, or an owner other than
//   vats98754, exits 2. FIKS_REALBUG_REMOTE_<ID> (ID upper-cased, other characters -> _) overrides
//   the clone URL, for tests; `repo` must still be valid.
// exit: 0 ok, 1 git failure, 2 bad usage or pins.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OWNER = 'vats98754';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_RE = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export class PinsError extends Error {}

/** FIKS_REALBUG_REMOTE_<ID>: `r10` -> FIKS_REALBUG_REMOTE_R10, `rb-x.1` -> FIKS_REALBUG_REMOTE_RB_X_1. */
export function remoteEnvName(id) {
  return `FIKS_REALBUG_REMOTE_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Validates a parsed pins.json; returns {repo, prefixSha, fixSha}. Throws PinsError. */
export function parsePins(pins, id) {
  if (!pins || typeof pins !== 'object') throw new PinsError(`${id}: pins.json is not an object`);
  const repo = pins.repo;
  if (typeof repo !== 'string' || repo === '') throw new PinsError(`${id}: pins.json has no 'repo' field`);
  const m = REPO_RE.exec(repo);
  if (!m) throw new PinsError(`${id}: repo '${repo}' is not <owner>/<name>`);
  if (m[1] !== OWNER) throw new PinsError(`${id}: repo '${repo}' is not owned by ${OWNER}`);
  const prefixSha = pins.prefixSha ?? pins.prefix;
  const fixSha = pins.fixSha ?? pins.fix;
  for (const [k, v] of [
    ['prefixSha', prefixSha],
    ['fixSha', fixSha],
  ]) {
    if (typeof v !== 'string' || !SHA_RE.test(v)) throw new PinsError(`${id}: ${k} is not a 40-hex SHA`);
  }
  return { repo, prefixSha, fixSha };
}

/** The clone URL: the override env var if set, else https://github.com/<repo>.git. No network. */
export function resolveRemote(pins, id, env = process.env) {
  const { repo } = parsePins(pins, id);
  const override = env[remoteEnvName(id)];
  return override ? override : `https://github.com/${repo}.git`;
}

const git = (cwd, args, opts = {}) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts,
  }).trim();

const tryGit = (cwd, args) => {
  try {
    return git(cwd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

const hasCommit = (dir, sha) => tryGit(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null;

/** Ensures one clone. Returns a summary of what it did. */
export function ensureOne(id, { pinsDir, root = ROOT, env = process.env, log = console.error }) {
  if (!ID_RE.test(id)) throw new PinsError(`bad id '${id}'`);
  const file = join(pinsDir, id, 'pins.json');
  if (!existsSync(file)) throw new PinsError(`${id}: ${file} not found`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new PinsError(`${id}: ${file} is not JSON (${e.message})`);
  }
  const pins = parsePins(raw, id);
  const url = resolveRemote(raw, id, env);
  const dir = join(root, '.work/realbugs', id);
  const did = { id, dir, url, cloned: false, fetched: [], tagged: [] };

  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(join(root, '.work/realbugs'), { recursive: true });
    log(`[ensure-realbugs] ${id}: cloning ${pins.repo} into .work/realbugs/${id}`);
    git(root, ['clone', '--origin', 'origin', url, dir]);
    did.cloned = true;
  }
  // origin = the pinned repo (or its override); no other remote.
  if (tryGit(dir, ['remote', 'get-url', 'origin']) !== url) {
    if (tryGit(dir, ['remote', 'get-url', 'origin']) === null) git(dir, ['remote', 'add', 'origin', url]);
    else git(dir, ['remote', 'set-url', 'origin', url]);
  }
  for (const r of (tryGit(dir, ['remote']) ?? '').split('\n').filter(Boolean)) {
    if (r !== 'origin') git(dir, ['remote', 'remove', r]);
  }
  for (const [tag, sha] of [
    ['prefix', pins.prefixSha],
    ['fix', pins.fixSha],
  ]) {
    if (!hasCommit(dir, sha)) {
      log(`[ensure-realbugs] ${id}: fetching ${tag} ${sha.slice(0, 12)}`);
      if (tryGit(dir, ['fetch', '--no-tags', 'origin', sha]) === null || !hasCommit(dir, sha)) {
        // Servers that refuse a want by SHA: fetch every branch, tag and pull ref, then look again.
        git(dir, [
          'fetch',
          '--tags',
          'origin',
          '+refs/heads/*:refs/remotes/origin/*',
          '+refs/pull/*:refs/remotes/origin/pull/*',
        ]);
      }
      if (!hasCommit(dir, sha)) throw new Error(`${id}: ${tag} ${sha} not found in ${url}`);
      did.fetched.push(tag);
    }
    if (tryGit(dir, ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]) !== sha) {
      git(dir, ['tag', '-f', tag, sha], { stdio: ['ignore', 'pipe', 'ignore'] });
      did.tagged.push(tag);
    }
  }
  return did;
}

export function listPinned(pinsDir) {
  if (!existsSync(pinsDir)) return [];
  return readdirSync(pinsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(pinsDir, d.name, 'pins.json')))
    .map((d) => d.name)
    .sort();
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { all: { type: 'boolean' }, id: { type: 'string' }, 'pins-dir': { type: 'string' } },
      strict: true,
    }));
  } catch (e) {
    console.error(`[ensure-realbugs] ${e.message}`);
    return 2;
  }
  if (Boolean(values.all) === Boolean(values.id)) {
    console.error('usage: node scripts/ensure-realbugs.mjs (--all | --id <id>) [--pins-dir <dir>]');
    return 2;
  }
  const pinsDir = resolve(values['pins-dir'] ?? env.FIKS_REALBUG_PINS_DIR ?? join(ROOT, 'realbugs'));
  const ids = values.all ? listPinned(pinsDir) : [values.id];
  if (ids.length === 0) console.error(`[ensure-realbugs] no <id>/pins.json under ${pinsDir}`);
  for (const id of ids) {
    try {
      const did = ensureOne(id, { pinsDir, env });
      console.log(JSON.stringify(did));
    } catch (e) {
      console.error(`[ensure-realbugs] ${e.message}`);
      return e instanceof PinsError ? 2 : 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
