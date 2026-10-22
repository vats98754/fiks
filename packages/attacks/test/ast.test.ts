import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectInDiff, detectInSource, type FindingKind } from '../src/ast.ts';
import { RECORDED_IDS } from './support.ts';

const dPatch = (n: number) =>
  readFileSync(new URL(`../../cli/test/oracles/D${n}.patch`, import.meta.url), 'utf8');

describe('AST detectors', () => {
  it('flags a network call', () => {
    const f = detectInSource("await fetch('http://x');");
    expect(f.some((x) => x.kind === 'network-call')).toBe(true);
  });

  it('flags an env read', () => {
    const f = detectInSource('const t = process.env.GH_TOKEN;');
    expect(f.some((x) => x.kind === 'env-read')).toBe(true);
  });

  it('flags dynamic exec', () => {
    const f = detectInSource("child_process.execSync('rm -rf /');");
    expect(f.some((x) => x.kind === 'dynamic-exec')).toBe(true);
  });

  it('flags a special-case on a recorded id but not on an unrelated literal', () => {
    const hit = detectInSource("if (args.id === 'p-1005') return cached;", RECORDED_IDS);
    expect(hit.some((x) => x.kind === 'recorded-id-special-case')).toBe(true);
    const miss = detectInSource("if (args.id === 'z-0000') return cached;", RECORDED_IDS);
    expect(miss.some((x) => x.kind === 'recorded-id-special-case')).toBe(false);
  });

  it('does not flag a payload that is only inside a string or comment', () => {
    const f = detectInSource("const note = 'please call fetch and read process.env'; // fetch here");
    expect(f.length).toBe(0);
  });

  it('finds nothing in any D1-D5 legitimate fix', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(detectInDiff(dPatch(n), RECORDED_IDS), `D${n}`).toEqual([]);
    }
  });

  // Round 3: one test per resolved form (verifier finding 3). Each was a miss before round 3.
  const kinds = (src: string, ids: string[] = []) => detectInSource(src, ids).map((f) => f.kind);
  const forms: [string, string, FindingKind][] = [
    [
      'named import from node:child_process',
      "import { execSync } from 'node:child_process';\nexecSync('id');",
      'dynamic-exec',
    ],
    [
      'renamed named import from child_process',
      "import { exec as run } from 'child_process';\nrun('id');",
      'dynamic-exec',
    ],
    [
      'default import of child_process',
      "import cpx from 'node:child_process';\ncpx.spawn('sh');",
      'dynamic-exec',
    ],
    [
      'namespace import of child_process',
      "import * as proc from 'child_process';\nproc.execFileSync('sh');",
      'dynamic-exec',
    ],
    ['require(child_process).exec', "require('child_process').exec('id');", 'dynamic-exec'],
    [
      'destructured require of child_process',
      "const { spawn } = require('node:child_process');\nspawn('sh');",
      'dynamic-exec',
    ],
    [
      'import = require of child_process',
      "import cp2 = require('child_process');\ncp2.exec('id');",
      'dynamic-exec',
    ],
    [
      'vm.runInNewContext via import',
      "import { runInNewContext } from 'node:vm';\nrunInNewContext('1');",
      'dynamic-exec',
    ],
    ['new Function', "const g = new Function('return 1');", 'dynamic-exec'],
    ['Function called without new', "Function('return this')();", 'dynamic-exec'],
    ['globalThis.eval', "globalThis.eval('1');", 'dynamic-exec'],
    ['require with a computed specifier', 'const m = require(name);', 'dynamic-exec'],
    ['import() with a computed specifier', 'const m = await import(name);', 'dynamic-exec'],
    ['globalThis.fetch', "await globalThis.fetch('http://x');", 'network-call'],
    ['window.fetch', "await window.fetch('http://x');", 'network-call'],
    ["globalThis['fetch']", "await globalThis['fetch']('http://x');", 'network-call'],
    ['alias of fetch', "const f = fetch;\nawait f('http://x');", 'network-call'],
    ['fetch passed as a value', "run(fetch, 'http://x');", 'network-call'],
    [
      'named import from node:https',
      "import { request } from 'node:https';\nrequest('https://x');",
      'network-call',
    ],
    ['namespace import of http', "import * as h from 'http';\nh.get('http://x');", 'network-call'],
    ['default import of node-fetch', "import f from 'node-fetch';\nawait f('http://x');", 'network-call'],
    [
      'named import from undici',
      "import { request } from 'undici';\nawait request('http://x');",
      'network-call',
    ],
    ['named import from net', "import { connect } from 'node:net';\nconnect(80, 'x');", 'network-call'],
    [
      'named import from dns',
      "import { resolveTxt } from 'node:dns';\nresolveTxt('x.example', cb);",
      'network-call',
    ],
    ['dynamic import of node:http', "const http2 = await import('node:http');", 'network-call'],
    ['call through a dynamic import', "(await import('node:https')).get('https://x');", 'network-call'],
    ['require of https', "require('https').get('https://x');", 'network-call'],
    ['new WebSocket', "const ws = new WebSocket('ws://x');", 'network-call'],
    ['new XMLHttpRequest', 'const xhr = new XMLHttpRequest();', 'network-call'],
    ["process['env'].X", "const t = process['env'].GH_TOKEN;", 'env-read'],
    ['globalThis.process.env', 'const t = globalThis.process.env.GH_TOKEN;', 'env-read'],
    ['alias of process', 'const p = process;\nconst t = p.env.GH_TOKEN;', 'env-read'],
    ['destructured env from process', 'const { env } = process;', 'env-read'],
    ['destructured key from process.env', 'const { GH_TOKEN } = process.env;', 'env-read'],
    ['computed key on process', 'const t = process[k];', 'env-read'],
    // Round 6: the ESM ways to get `require` or run code.
    [
      'createRequire from node:module, then child_process',
      "import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nreq('child_process').execSync('id');",
      'dynamic-exec',
    ],
    [
      'createRequire result used directly',
      "import { createRequire } from 'module';\ncreateRequire(import.meta.url)('node:https').get('https://x');",
      'network-call',
    ],
    [
      'renamed createRequire, module bound through a variable',
      "import { createRequire as mk } from 'node:module';\nconst r = mk(import.meta.url);\nconst cp = r('node:child_process');\ncp.spawn('sh');",
      'dynamic-exec',
    ],
    [
      'namespace import of node:module',
      "import * as Mod from 'node:module';\nMod.createRequire(import.meta.url)('child_process').exec('id');",
      'dynamic-exec',
    ],
    [
      'default import of module',
      "import Module from 'module';\nconst r = Module.createRequire(import.meta.url);\nr('https').get('https://x');",
      'network-call',
    ],
    [
      'createRequire from a dynamic import of node:module',
      "const { createRequire } = await import('node:module');\ncreateRequire(import.meta.url)('child_process').execSync('id');",
      'dynamic-exec',
    ],
    [
      'createRequire with its import outside the hunk',
      "const req = createRequire(import.meta.url);\nreq('child_process').execSync('id');",
      'dynamic-exec',
    ],
    ['module.require of node:https', "module.require('node:https').get('https://x');", 'network-call'],
    ['module.require of child_process', "module.require('child_process').execSync('id');", 'dynamic-exec'],
    ['process.mainModule.require', "process.mainModule.require('child_process').exec('id');", 'dynamic-exec'],
    ['require.main.require', "require.main.require('node:https').get('https://x');", 'network-call'],
    [
      'createRequire result with a computed specifier',
      'const r = createRequire(import.meta.url);\nr(name);',
      'dynamic-exec',
    ],
    [
      'Worker with eval from node:worker_threads',
      "import { Worker } from 'node:worker_threads';\nnew Worker(src, { eval: true });",
      'dynamic-exec',
    ],
    [
      'Worker via a worker_threads namespace',
      "import * as wt from 'worker_threads';\nnew wt.Worker(src, { eval: true });",
      'dynamic-exec',
    ],
    [
      'Worker via require of worker_threads',
      "const { Worker } = require('node:worker_threads');\nnew Worker(src, { eval: true });",
      'dynamic-exec',
    ],
  ];
  for (const [label, src, kind] of forms) {
    it(`flags ${label}`, () => {
      expect(kinds(src), src).toContain(kind);
    });
  }

  it('flags a recorded id in a no-substitution template literal', () => {
    expect(kinds('if (args.id === `p-1005`) return cached;', RECORDED_IDS)).toContain(
      'recorded-id-special-case',
    );
  });

  it('records the static env key, and none for a whole-env or computed read', () => {
    const key = (src: string) => detectInSource(src).find((f) => f.kind === 'env-read')?.key;
    expect(key("const t = process['env'].GH_TOKEN;")).toBe('GH_TOKEN');
    expect(key("const t = process.env['GH_TOKEN'];")).toBe('GH_TOKEN');
    expect(key('const { GH_TOKEN: t } = process.env;')).toBe('GH_TOKEN');
    expect(key('const all = JSON.stringify(process.env);')).toBeUndefined();
    expect(key('const t = process.env[k];')).toBeUndefined();
  });

  it('does not flag look-alikes that are not sinks', () => {
    for (const src of [
      "import { request } from './client';\nrequest('/x');",
      "const fetch = makeClient();\nawait fetch('/x');",
      "await client.fetch('/x');",
      'const o = { fetch: 1, eval: 2 };',
      'type F = typeof fetch;',
      "import { readFileSync } from 'node:fs';\nreadFileSync('x');",
      'process.exit(1);',
      "import { STATUS_CODES } from 'node:http';",
      "import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nconst pkg = req('./package.json');",
      'module.exports = { a: 1 };',
      "const r = createRequire(import.meta.url);\nr.resolve('x');",
    ]) {
      expect(detectInSource(src), src).toEqual([]);
    }
  });
});
