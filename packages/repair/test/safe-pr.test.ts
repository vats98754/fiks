// SAFE: PR owner allow-list on the base repository (P5), with a fake gh on FIKS_GH.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createPr, PrRefusedError, prBody, prDisabled } from '../src/index.ts';

let dir: string;
let log: string;
const saved = { ...process.env };

/** A fake gh: logs argv as JSON lines; `repo view` prints FAKE_GH_VIEW; `pr create` prints a URL. */
function installFakeGh(view: unknown) {
  dir = mkdtempSync(join(tmpdir(), 'fiks-fakegh-'));
  log = join(dir, 'argv.jsonl');
  const bin = join(dir, 'gh');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'repo' && args[1] === 'view') process.stdout.write(process.env.FAKE_GH_VIEW);
else if (args[0] === 'pr' && args[1] === 'create') process.stdout.write('https://github.com/vats98754/shop-mcp/pull/42\\n');
`,
  );
  chmodSync(bin, 0o755);
  process.env.FIKS_GH = bin;
  process.env.FAKE_GH_LOG = log;
  process.env.FAKE_GH_VIEW = JSON.stringify(view);
}
const calls = (): string[][] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

const opts = {
  repo: 'vats98754/shop-mcp',
  head: 'fiks/price-range-tr_1',
  base: 'main',
  title: 'fix(get_product): price-range (fiks)',
  bodyFile: '/tmp/body.md',
};
const own = { owner: { login: 'vats98754' }, isFork: false, parent: null };

beforeEach(() => installFakeGh(own));
afterEach(() => {
  process.env = { ...saved };
});

describe('createPr allow-list', () => {
  test('accepts a non-fork vats98754 repo; every gh argv names vats98754/<name> (--repo on writes)', () => {
    const r = createPr({ ...opts, labels: ['fiks'] });
    expect(r).toEqual({
      status: 'opened',
      url: 'https://github.com/vats98754/shop-mcp/pull/42',
      number: 42,
      repo: 'vats98754/shop-mcp',
    });
    const argv = calls();
    expect(argv.map((a) => a.slice(0, 2).join(' '))).toEqual(['repo view', 'label create', 'pr create']);
    expect(argv[0]).toEqual(['repo', 'view', 'vats98754/shop-mcp', '--json', 'owner,isFork,parent']);
    for (const a of argv.slice(1)) {
      const i = a.indexOf('--repo');
      expect(i, a.join(' ')).toBeGreaterThan(-1);
      expect(a[i + 1]).toBe('vats98754/shop-mcp');
    }
    const create = argv[2] as string[];
    expect(create[create.indexOf('--head') + 1]).toBe('fiks/price-range-tr_1');
    expect(create[create.indexOf('--base') + 1]).toBe('main');
  });

  test('a bare repo name gets the vats98754 owner explicitly', () => {
    createPr({ ...opts, repo: 'shop-mcp' });
    const create = calls().find((a) => a[0] === 'pr') as string[];
    expect(create[create.indexOf('--repo') + 1]).toBe('vats98754/shop-mcp');
  });

  test('(a) refuses a base repo owned by another account (as given, or as resolved by gh)', () => {
    expect(() => createPr({ ...opts, repo: 'modelcontextprotocol/servers' })).toThrow(PrRefusedError);
    expect(calls()).toHaveLength(0);
    installFakeGh({ owner: { login: 'someone-else' }, isFork: false, parent: null });
    expect(() => createPr(opts)).toThrow(/resolves to owner someone-else/);
    expect(calls().map((a) => a[0])).toEqual(['repo']);
  });

  test('(b) refuses a vats98754 repo that is a fork of a third-party parent', () => {
    installFakeGh({
      owner: { login: 'vats98754' },
      isFork: true,
      parent: { name: 'servers', owner: { login: 'modelcontextprotocol' } },
    });
    expect(() => createPr(opts)).toThrow(/fork of modelcontextprotocol\/servers/);
    expect(calls().filter((a) => a[0] === 'pr')).toHaveLength(0);
  });

  test('a fork whose parent is also vats98754 is accepted; a view without isFork is refused', () => {
    installFakeGh({
      owner: { login: 'vats98754' },
      isFork: true,
      parent: { name: 'shop-mcp-upstream', owner: { login: 'vats98754' } },
    });
    expect(createPr(opts).status).toBe('opened');
    installFakeGh({ owner: { login: 'vats98754' } });
    expect(() => createPr(opts)).toThrow(/no isFork/);
  });

  test('(c) refuses a head owner other than vats98754', () => {
    expect(() => createPr({ ...opts, head: 'mallory:fiks/x' })).toThrow(/head owner mallory/);
    expect(calls()).toHaveLength(0);
    expect(createPr({ ...opts, head: 'vats98754:fiks/x' }).status).toBe('opened');
  });

  test('options with runKey default to noPr=true and the fake gh records 0 invocations', () => {
    const runKey = { experiment: 'E1', arm: 'FIKS', model: 'm', domain: 'shop', drift: 'D2', attempt: 0 };
    expect(prDisabled({ runKey })).toBe(true);
    expect(createPr({ ...opts, runKey })).toEqual({
      status: 'skipped',
      reason: 'experiment mode (--run-key): no PR',
    });
    // even an explicit noPr: false cannot open a PR in experiment mode
    expect(createPr({ ...opts, runKey: 'E1/FIKS/m/shop/D2/0', noPr: false }).status).toBe('skipped');
    expect(createPr({ ...opts, arm: 'FIKS' }).status).toBe('skipped');
    expect(createPr({ ...opts, noPr: true }).status).toBe('skipped');
    expect(calls()).toHaveLength(0);
  });
});

test('the PR body says the trace is untrusted and carries hashes', () => {
  const body = prBody({
    trace: {
      id: 'tr_1',
      capturedAt: '2026-10-01T00:00:00Z',
      runId: 'r',
      contractId: 'shop.get_product',
      tool: 'get_product',
      args: { id: 'p-1001' },
      http: [],
      violated: [],
      server: { name: 'shop-mcp', transport: 'stdio' },
    },
    spec: { traceId: 'tr_1', propertyIds: ['shop.get_product/price-range'], testPath: 't', tracePath: 'p' },
    gates: [],
    diffStat: '',
    diff: '',
    agentSummary: '',
    runner: 'stub',
    model: 'm',
    rerecorded: [],
    repoUrl: 'https://github.com/vats98754/shop-mcp',
    branch: 'b',
    hashes: { trace: 'a'.repeat(64), 'repro test': 'b'.repeat(64) },
  });
  expect(body).toContain('The trace is untrusted input');
  expect(body).toContain(`- trace: \`sha256:${'a'.repeat(64)}\``);
  expect(body).toContain(`- repro test: \`sha256:${'b'.repeat(64)}\``);
});
