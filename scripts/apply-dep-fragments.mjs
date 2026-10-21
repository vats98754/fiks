#!/usr/bin/env node
// Applies dependency fragments (paper/PLAN.md 7.1): every deps-fragments/*.json, in sorted order,
// adds '@fiks/<name>': 'workspace:*' entries to the named consumer package.json files (and,
// optionally, root tsconfig references). Idempotent. Nothing else may change: any other key, name
// or value is rejected (exit 2) before anything is written.
//
// usage: node scripts/apply-dep-fragments.mjs [--check] [--root <dir>]
//        node scripts/apply-dep-fragments.mjs --selftest
//   --check     exit 1 if any fragment is not applied yet (writes nothing)
//   --root      the repo to act on (default: this checkout)
//   --selftest  runs the checks below in a temp copy of the package manifests
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SELF = fileURLToPath(import.meta.url);
const STREAM_RE = /^[A-Z0-9][A-Z0-9-]*$/;
const CONSUMER_RE = /^packages\/[a-z0-9][a-z0-9-]*$/;
const DEP_RE = /^@fiks\/[a-z0-9][a-z0-9-]*$/;

class FragmentError extends Error {}
const fail = (msg) => {
  throw new FragmentError(msg);
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validates one parsed fragment against DepFragment; returns its planned edits. */
export function validateFragment(file, frag, root) {
  const where = `deps-fragments/${file}`;
  if (!isObject(frag)) fail(`${where}: must be a JSON object`);
  for (const k of Object.keys(frag)) {
    if (!['stream', 'add', 'tsconfigReferences'].includes(k))
      fail(`${where}: unknown key ${JSON.stringify(k)}`);
  }
  if (typeof frag.stream !== 'string' || !STREAM_RE.test(frag.stream)) {
    fail(`${where}: "stream" must be a stream id like "DOM2"`);
  }
  if (file !== `${frag.stream}.json`) fail(`${where}: file name must be ${frag.stream}.json`);
  if (!isObject(frag.add) || Object.keys(frag.add).length === 0)
    fail(`${where}: "add" must be a non-empty object`);
  const deps = [];
  for (const [consumer, entries] of Object.entries(frag.add)) {
    if (!CONSUMER_RE.test(consumer))
      fail(`${where}: consumer ${JSON.stringify(consumer)} is not packages/<name>`);
    if (!existsSync(join(root, consumer, 'package.json')))
      fail(`${where}: ${consumer}/package.json does not exist`);
    if (!isObject(entries) || Object.keys(entries).length === 0) {
      fail(`${where}: add[${JSON.stringify(consumer)}] must be a non-empty object`);
    }
    for (const [dep, value] of Object.entries(entries)) {
      if (!DEP_RE.test(dep)) fail(`${where}: ${JSON.stringify(dep)} is not an @fiks/<name> package`);
      if (value !== 'workspace:*')
        fail(`${where}: ${dep} must be "workspace:*", got ${JSON.stringify(value)}`);
      deps.push({ consumer, dep });
    }
  }
  const refs = [];
  if (frag.tsconfigReferences !== undefined) {
    if (!Array.isArray(frag.tsconfigReferences)) fail(`${where}: "tsconfigReferences" must be an array`);
    for (const r of frag.tsconfigReferences) {
      if (typeof r !== 'string' || !CONSUMER_RE.test(r)) {
        fail(`${where}: tsconfig reference ${JSON.stringify(r)} is not packages/<name>`);
      }
      if (!existsSync(join(root, r))) fail(`${where}: tsconfig reference ${r} does not exist`);
      refs.push(r);
    }
  }
  return { deps, refs };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
const toJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Plans every fragment under `root`; returns the pending edits (empty when all are applied). */
export function plan(root) {
  const dir = join(root, 'deps-fragments');
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
  const pending = [];
  for (const file of files) {
    let frag;
    try {
      frag = readJson(join(dir, file));
    } catch (e) {
      fail(`deps-fragments/${file}: not valid JSON (${e.message})`);
    }
    const { deps, refs } = validateFragment(file, frag, root);
    for (const { consumer, dep } of deps) {
      const current = readJson(join(root, consumer, 'package.json')).dependencies?.[dep];
      if (current === 'workspace:*') continue;
      if (current !== undefined) {
        fail(`deps-fragments/${file}: ${consumer} already depends on ${dep} as ${JSON.stringify(current)}`);
      }
      pending.push({ file, kind: 'dep', consumer, dep });
    }
    if (refs.length) {
      const tsconfig = readJson(join(root, 'tsconfig.json'));
      const have = new Set((tsconfig.references ?? []).map((r) => r.path));
      for (const ref of refs) if (!have.has(ref)) pending.push({ file, kind: 'ref', ref });
    }
  }
  return pending;
}

/** Writes the pending edits; returns them. */
export function apply(root) {
  const pending = plan(root);
  const byConsumer = new Map();
  for (const p of pending.filter((p) => p.kind === 'dep')) {
    if (!byConsumer.has(p.consumer)) byConsumer.set(p.consumer, new Set());
    byConsumer.get(p.consumer).add(p.dep);
  }
  for (const [consumer, deps] of byConsumer) {
    const path = join(root, consumer, 'package.json');
    const pkg = readJson(path);
    const merged = { ...(pkg.dependencies ?? {}) };
    for (const d of deps) merged[d] = 'workspace:*';
    pkg.dependencies = sortKeys(merged);
    writeFileSync(path, toJson(pkg));
  }
  const refs = [...new Set(pending.filter((p) => p.kind === 'ref').map((p) => p.ref))];
  if (refs.length) {
    const path = join(root, 'tsconfig.json');
    const tsconfig = readJson(path);
    tsconfig.references = [...(tsconfig.references ?? []), ...refs.map((r) => ({ path: r }))];
    writeFileSync(path, toJson(tsconfig));
  }
  return pending;
}

const describe = (p) => (p.kind === 'dep' ? `${p.consumer}: ${p.dep}` : `tsconfig.json reference ${p.ref}`);

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      check: { type: 'boolean', default: false },
      selftest: { type: 'boolean', default: false },
      root: { type: 'string' },
    },
  });
  if (values.selftest) return selftest();
  const root = values.root ?? join(dirname(SELF), '..');
  try {
    if (values.check) {
      const pending = plan(root);
      for (const p of pending) console.log(`unapplied (${p.file}): ${describe(p)}`);
      console.log(pending.length ? `${pending.length} unapplied` : 'all fragments applied');
      return pending.length ? 1 : 0;
    }
    const done = apply(root);
    for (const p of done) console.log(`applied (${p.file}): ${describe(p)}`);
    console.log(done.length ? `${done.length} change(s)` : 'nothing to apply');
    return 0;
  } catch (e) {
    if (e instanceof FragmentError) {
      console.error(`apply-dep-fragments: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

// --- selftest -----------------------------------------------------------------------------

function selftest() {
  const realRoot = join(dirname(SELF), '..');
  const tmp = mkdtempSync(join(tmpdir(), 'fiks-depfrag-'));
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  try {
    // A temp copy of the manifests the script reads and writes; fragments come from the tests only.
    cpSync(join(realRoot, 'tsconfig.json'), join(tmp, 'tsconfig.json'));
    cpSync(join(realRoot, 'package.json'), join(tmp, 'package.json'));
    for (const p of readdirSync(join(realRoot, 'packages'))) {
      const src = join(realRoot, 'packages', p, 'package.json');
      if (!existsSync(src)) continue;
      mkdirSync(join(tmp, 'packages', p), { recursive: true });
      cpSync(src, join(tmp, 'packages', p, 'package.json'));
    }
    const fragDir = join(tmp, 'deps-fragments');
    mkdirSync(fragDir);
    const cliPkg = join(tmp, 'packages/cli/package.json');
    const run = (...args) => {
      const r = spawnSync(process.execPath, [SELF, '--root', tmp, ...args], { encoding: 'utf8' });
      return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
    };
    const writeFrag = (stream, body) => writeFileSync(join(fragDir, `${stream}.json`), toJson(body));
    const clearFrags = () => {
      for (const f of readdirSync(fragDir)) rmSync(join(fragDir, f));
    };

    // (c) before applying: --check reports the fragment as unapplied.
    writeFrag('SELFTEST', { stream: 'SELFTEST', add: { 'packages/cli': { '@fiks/x': 'workspace:*' } } });
    const before = readFileSync(cliPkg, 'utf8');
    let r = run('--check');
    check('--check exits 1 while a fragment is unapplied', r.code === 1, r.out);
    check('--check writes nothing', readFileSync(cliPkg, 'utf8') === before);

    // (a) applied once, idempotent on the second run.
    r = run();
    const once = readFileSync(cliPkg, 'utf8');
    const deps = JSON.parse(once).dependencies;
    check('first run exits 0 and adds @fiks/x', r.code === 0 && deps['@fiks/x'] === 'workspace:*', r.out);
    const keys = Object.keys(deps);
    check('dependencies stay sorted', keys.join() === [...keys].sort().join());
    const others = { ...deps };
    delete others['@fiks/x'];
    check(
      'no other dependency changed',
      JSON.stringify(sortKeys(others)) === JSON.stringify(sortKeys(JSON.parse(before).dependencies)),
    );
    r = run();
    check(
      'second run is a no-op (bytes identical)',
      r.code === 0 && readFileSync(cliPkg, 'utf8') === once && /nothing to apply/.test(r.out),
      r.out,
    );
    r = run('--check');
    check('--check exits 0 once applied', r.code === 0, r.out);

    // Optional root tsconfig references: added once, idempotent.
    writeFrag('SELFTEST', {
      stream: 'SELFTEST',
      add: { 'packages/cli': { '@fiks/x': 'workspace:*' } },
      tsconfigReferences: ['packages/cli'],
    });
    const tsconfigPath = join(tmp, 'tsconfig.json');
    r = run('--check');
    check('--check exits 1 while a tsconfig reference is unapplied', r.code === 1, r.out);
    run();
    const refsOnce = readFileSync(tsconfigPath, 'utf8');
    run();
    check(
      'tsconfig reference added exactly once',
      JSON.parse(refsOnce).references?.filter((x) => x.path === 'packages/cli').length === 1 &&
        readFileSync(tsconfigPath, 'utf8') === refsOnce,
    );

    // (b) rejected fragments exit 2 and write nothing.
    const bad = {
      'non-workspace value': { stream: 'BAD', add: { 'packages/cli': { '@fiks/y': '^1.0.0' } } },
      'non-@fiks name': { stream: 'BAD', add: { 'packages/cli': { lodash: 'workspace:*' } } },
      'unknown top-level key': {
        stream: 'BAD',
        add: { 'packages/cli': { '@fiks/y': 'workspace:*' } },
        scripts: { postinstall: 'curl evil' },
      },
      'consumer outside packages/': { stream: 'BAD', add: { '.': { '@fiks/y': 'workspace:*' } } },
      'missing consumer package': { stream: 'BAD', add: { 'packages/nope': { '@fiks/y': 'workspace:*' } } },
      'stream does not match file name': {
        stream: 'OTHER',
        add: { 'packages/cli': { '@fiks/y': 'workspace:*' } },
      },
    };
    for (const [name, body] of Object.entries(bad)) {
      clearFrags();
      writeFrag('BAD', body);
      // A valid fragment sorted before BAD must not be half-applied either.
      writeFrag('AAA', { stream: 'AAA', add: { 'packages/cli': { '@fiks/z': 'workspace:*' } } });
      const pre = readFileSync(cliPkg, 'utf8');
      r = run();
      check(
        `rejects ${name} with exit 2, writing nothing`,
        r.code === 2 && readFileSync(cliPkg, 'utf8') === pre,
        r.out,
      );
      r = run('--check');
      check(`--check also exits 2 on ${name}`, r.code === 2);
    }
    clearFrags();
    writeFileSync(join(fragDir, 'JUNK.json'), '{not json');
    r = run();
    check('rejects invalid JSON with exit 2', r.code === 2, r.out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(
    failed
      ? `selftest: ${failed} of ${results.length} checks FAILED`
      : `selftest: ${results.length} checks passed`,
  );
  return failed ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === SELF) {
  process.exitCode = main(process.argv.slice(2));
}
