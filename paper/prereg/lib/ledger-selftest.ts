// Toy-repo self-test for the freeze-ledger checker. Builds throwaway git repositories under the
// OS temp dir (never touches the fiks repo), records freezes, and checks pass/fail per case.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git, sha256 } from './git.ts';
import {
  CANONICAL,
  type CheckResult,
  checkLedger,
  type ExternalRef,
  type Freeze,
  type Ledger,
} from './ledger.ts';

function run(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'selftest',
      GIT_AUTHOR_EMAIL: 'selftest@example.invalid',
      GIT_COMMITTER_NAME: 'selftest',
      GIT_COMMITTER_EMAIL: 'selftest@example.invalid',
    },
  }).trimEnd();
}

function write(root: string, rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  run(dir, ['init', '-q', '-b', 'main']);
}

function commitAll(dir: string, msg: string): string {
  run(dir, ['add', '-A']);
  run(dir, ['commit', '-q', '--no-gpg-sign', '-m', msg]);
  return run(dir, ['rev-parse', 'HEAD']);
}

function annotatedTag(dir: string, tag: string, commit: string): void {
  run(dir, ['tag', '-a', '-m', tag, tag, commit]);
}

const BRIEF_KINDS = ['catalog', 'contract-author', 'drift', 'evasive', 'benign', 'fixer', 'rater'];
const DOCS = {
  shop: ['packages/vendor-api/openapi.json', 'packages/vendor-api/docs/shop.md'],
  tracker: ['packages/vendor-tracker/docs/openapi.json', 'packages/vendor-tracker/docs/tracker.md'],
};
const RECORDS_HASH = sha256('toy frame CallRecords');
const FRAME_SPEC = {
  domain: ['shop'],
  nF: 3,
  eligibleInputs: ['in1'],
  entities: [{ id: 'ext-a', domain: 'shop', authorBatch: 'b1', eligible: true }],
  NE: 1,
  attribution: { in1: { 'items[0].price': 'ext-a' } },
  families: { 'items.price.range': 'price' },
  cells: [{ contract: 'shop-mcp', property: 'items.price.range', class: 'all', nInputs: 1 }],
  K: 1,
  entailedProps: [],
  neRule: { topUpBatches: 0, underpowered: true, m: 3 },
  crit: -1,
  power: { pi01: 0, pi005: 0 },
  hash: RECORDS_HASH,
};

/** Files committed at the commit a freeze is tagged on. */
function filesFor(id: string): Record<string, string> {
  switch (id) {
    case 'F2': {
      const out: Record<string, string> = {};
      for (const p of [...DOCS.shop, ...DOCS.tracker]) out[p] = `docs ${p}\n`;
      for (const k of BRIEF_KINDS) out[`packages/authoring/briefs/${k}.md`] = `brief ${k}\n`;
      return out;
    }
    case 'F4':
      return { 'paper/prereg/A0-RECORD.md': 'A0 record\n' };
    case 'F4b':
      return { 'paper/prereg/frame-spec.json': `${JSON.stringify(FRAME_SPEC, null, 2)}\n` };
    case 'F5':
      return { 'paper/prereg/PREREG.md': 'prereg\n', 'paper/prereg/REGISTRY.json': '{}\n' };
    case 'F8':
      return { 'paper/prereg/K1-ADDENDUM.md': 'K1\n' };
    default:
      return { [`paper/prereg/step-${id}.txt`]: `${id}\n` };
  }
}

export interface Toy {
  root: string;
  commits: Record<string, string>;
  externals: Record<string, { dir: string; commit: string; tagObject: string | null; ref: string }>;
  files: Record<string, Record<string, string>>;
}

export interface ToyOptions {
  /** Freeze ids in commit order (each gets its own commit and tag). Default: canonical order. */
  order?: string[];
  /** Freeze ids whose commit goes on a side branch cut from the first commit. */
  side?: string[];
  /** Freeze ids that get no tag. */
  untagged?: string[];
}

const toyCache = new Map<string, Toy>();

/** Toy repos are never mutated by a case, so identical layouts are built once. */
export function buildToy(opts: ToyOptions = {}): Toy {
  const key = JSON.stringify(opts);
  const cached = toyCache.get(key);
  if (cached !== undefined) return cached;
  const toy = buildToyUncached(opts);
  toyCache.set(key, toy);
  return toy;
}

export function cleanupToys(): void {
  for (const t of toyCache.values()) rmSync(t.root, { recursive: true, force: true });
  toyCache.clear();
}

function buildToyUncached(opts: ToyOptions): Toy {
  const root = mkdtempSync(join(tmpdir(), 'prereg-ledger-'));
  initRepo(root);
  write(root, '.gitignore', '.work/\n');
  write(root, 'README.md', 'toy\n');
  const first = commitAll(root, 'init');
  const order = opts.order ?? CANONICAL.map((c) => c.id);
  const commits: Record<string, string> = {};
  const files: Record<string, Record<string, string>> = {};
  for (const id of order) {
    const onSide = opts.side?.includes(id) ?? false;
    if (onSide) run(root, ['checkout', '-q', '-b', `side-${id}`, first]);
    const f = filesFor(id);
    for (const [p, t] of Object.entries(f)) write(root, p, t);
    files[id] = f;
    commits[id] = commitAll(root, `freeze ${id}`);
    if (onSide) run(root, ['checkout', '-q', 'main']);
  }
  for (const c of CANONICAL) {
    const commit = commits[c.id];
    if (commit !== undefined && !(opts.untagged ?? []).includes(c.id)) annotatedTag(root, c.tag, commit);
  }
  const externals: Toy['externals'] = {};
  for (const [name, tagged] of [
    ['base-shop', true],
    ['seed-tracker-v1', true],
    ['driftbench-blind', false],
  ] as const) {
    const dir = join(root, '.work', name);
    initRepo(dir);
    write(dir, 'x.txt', `${name}\n`);
    const commit = commitAll(dir, name);
    let tagObject: string | null = null;
    if (tagged) {
      annotatedTag(dir, name, commit);
      tagObject = run(dir, ['rev-parse', `refs/tags/${name}`]);
    }
    externals[name] = { dir, commit, tagObject, ref: tagged ? name : 'main' };
  }
  return { root, commits, externals, files };
}

const EXT_REPO: Record<string, string> = {
  'base-shop': 'vats98754/shop-mcp',
  'seed-tracker-v1': 'vats98754/tracker-mcp',
  'driftbench-blind': 'vats98754/driftbench-blind',
};
const EXT_FOR: Record<string, string> = { F2: 'base-shop', F4: 'seed-tracker-v1', F6: 'driftbench-blind' };

/** A ledger recording every freeze that has a commit in the toy repo. */
export function ledgerFor(toy: Toy, recorded?: string[]): Ledger {
  const ids = recorded ?? Object.keys(toy.commits);
  const freezes: Freeze[] = CANONICAL.map((c, i) => {
    const commit = toy.commits[c.id];
    const record =
      commit !== undefined && ids.includes(c.id)
        ? {
            peeledCommit: commit,
            treeHash: git(toy.root, ['rev-parse', `${commit}^{tree}`]),
            timestamp: `2026-11-01T00:${String(i).padStart(2, '0')}:00Z`,
            externalRefs: [] as ExternalRef[],
            files: [] as { path: string; sha256: string }[],
          }
        : null;
    if (record !== null) {
      const ext = EXT_FOR[c.id];
      if (ext !== undefined) {
        const e = toy.externals[ext];
        if (e === undefined) throw new Error(`no external ${ext}`);
        record.externalRefs.push({
          name: ext,
          repo: EXT_REPO[ext] as string,
          localPath: `.work/${ext}`,
          ref: e.ref,
          peeledCommit: e.commit,
        });
      }
      const f = toy.files[c.id] ?? {};
      if (c.id !== 'F2') {
        for (const [p, t] of Object.entries(f)) record.files.push({ path: p, sha256: sha256(t) });
      }
    }
    let details: Record<string, unknown> = {};
    if (c.id === 'F2') {
      const done = record !== null;
      details = {
        docs: {
          shop: DOCS.shop.map((p) => ({ path: p, sha256: done ? sha256(`docs ${p}\n`) : null })),
          tracker: DOCS.tracker.map((p) => ({ path: p, sha256: done ? sha256(`docs ${p}\n`) : null })),
        },
        briefs: BRIEF_KINDS.map((k) => ({
          kind: k,
          path: done ? `packages/authoring/briefs/${k}.md` : null,
          sha256: done ? sha256(`brief ${k}\n`) : null,
        })),
        noBoundCheck: {
          command: 'pnpm fiks author --check-no-bounds',
          exitCode: done ? 0 : null,
          result: done ? 'pass' : null,
          outputSha256: done ? sha256('no-bound output') : null,
        },
        shopDocsAuthorshipNote: 'written by the CORE builder, who has read the contracts',
        frozenClock: {
          shop: done ? '2026-01-15T12:00:00Z' : null,
          tracker: done ? '2026-01-15T12:00:00Z' : null,
        },
      };
    } else if (c.id === 'F4b') {
      const done = record !== null;
      details = {
        frameSpecPath: 'paper/prereg/frame-spec.json',
        frameSpecSha256: done ? sha256(`${JSON.stringify(FRAME_SPEC, null, 2)}\n`) : null,
        frameRecordsSha256: done ? RECORDS_HASH : null,
        NE: done ? 1 : null,
        crit: done ? -1 : null,
        m: done ? 3 : null,
      };
    } else if (c.id === 'F9') {
      details = {
        traces:
          record !== null
            ? [{ driftId: 'BLIND-001', traceSha256: sha256('t'), ivSidecarSha256: sha256('iv') }]
            : [],
      };
    } else if (c.id === 'F10') {
      details = { poolSha256: record !== null ? sha256('pool') : null, requestChanging: {} };
    }
    return { id: c.id, tag: c.tag, content: c.id, mustPrecede: [...c.mustPrecede], record, details };
  });
  return { $schema: './freeze-ledger.schema.json', schemaVersion: 1, freezes };
}

function freeze(l: Ledger, id: string): Freeze {
  const f = l.freezes.find((x) => x.id === id);
  if (f === undefined) throw new Error(id);
  return f;
}

export interface Case {
  name: string;
  expect: 'pass' | 'fail';
  /** Substring the first matching error must contain (fail cases). */
  reason?: string;
  make(): { ledger: unknown; repo: string };
}

export const CASES: Case[] = [
  {
    name: 'correct order, every freeze recorded',
    expect: 'pass',
    make() {
      const t = buildToy();
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'empty ledger, no tags (the pre-F1 state)',
    expect: 'pass',
    make() {
      const t = buildToy({ order: [] });
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'partial: F1-F4 tagged and recorded',
    expect: 'pass',
    make() {
      const t = buildToy({ order: ['F1', 'F2', 'F3', 'F4'] });
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'out-of-order tags: F1 tagged after F2',
    expect: 'fail',
    reason: 'F1 (freeze-operators) must precede F2',
    make() {
      const order = CANONICAL.map((c) => c.id).filter((id) => id !== 'F1');
      order.splice(1, 0, 'F1');
      const t = buildToy({ order });
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'non-ancestor tag: F3 on a side branch',
    expect: 'fail',
    reason: 'F3 (freeze-analysis) must precede F5',
    make() {
      const t = buildToy({ side: ['F3'] });
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'F4b tagged after F5',
    expect: 'fail',
    reason: 'F4b (frame-frozen) must precede F5',
    make() {
      const order = ['F1', 'F2', 'F3', 'F4', 'F5', 'F4b', 'F6', 'F7', 'F8', 'F9', 'F10'];
      const t = buildToy({ order });
      return { ledger: ledgerFor(t), repo: t.root };
    },
  },
  {
    name: 'F5 recorded while F4b is not',
    expect: 'fail',
    reason: 'F5 (prereg-v1) is recorded but F4b',
    make() {
      const t = buildToy({ untagged: ['F4b'] });
      const ids = Object.keys(t.commits).filter((id) => id !== 'F4b');
      return { ledger: ledgerFor(t, ids), repo: t.root };
    },
  },
  {
    name: 'external ref recorded as its tag object (base-shop)',
    expect: 'fail',
    reason: 'which is a tag object',
    make() {
      const t = buildToy();
      const l = ledgerFor(t);
      const ext = freeze(l, 'F2').record?.externalRefs[0];
      if (ext === undefined) throw new Error('no ext');
      ext.peeledCommit = t.externals['base-shop']?.tagObject as string;
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'fiks tag recorded as its tag object instead of the peeled commit',
    expect: 'fail',
    reason: 'not a commit',
    make() {
      const t = buildToy();
      const l = ledgerFor(t);
      const rec = freeze(l, 'F5').record;
      if (rec === null) throw new Error('no record');
      rec.peeledCommit = git(t.root, ['rev-parse', 'refs/tags/prereg-v1']);
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'timestamps out of order (F1 later than F2)',
    expect: 'fail',
    reason: 'is not earlier',
    make() {
      const t = buildToy();
      const l = ledgerFor(t);
      const rec = freeze(l, 'F1').record;
      if (rec === null) throw new Error('no record');
      rec.timestamp = '2026-12-31T00:00:00Z';
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'weakened edge: F4b.mustPrecede emptied',
    expect: 'fail',
    reason: 'mustPrecede must be',
    make() {
      const t = buildToy();
      const l = ledgerFor(t);
      freeze(l, 'F4b').mustPrecede = [];
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'tag exists without a ledger record',
    expect: 'fail',
    reason: 'exists but the ledger has no record',
    make() {
      const t = buildToy({ order: ['F1', 'F2'] });
      return { ledger: ledgerFor(t, ['F1']), repo: t.root };
    },
  },
  {
    name: 'tree hash mismatch',
    expect: 'fail',
    reason: 'tree of',
    make() {
      const t = buildToy({ order: ['F1'] });
      const l = ledgerFor(t);
      const rec = freeze(l, 'F1').record;
      if (rec === null) throw new Error('no record');
      rec.treeHash = '0'.repeat(40);
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'F2 brief hash tampered',
    expect: 'fail',
    reason: 'sha256 of packages/authoring/briefs/catalog.md',
    make() {
      const t = buildToy({ order: ['F1', 'F2'] });
      const l = ledgerFor(t);
      const d = freeze(l, 'F2').details as { briefs: { sha256: string }[] };
      (d.briefs[0] as { sha256: string }).sha256 = sha256('other');
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'F2 recorded with a failing no-bound check',
    expect: 'fail',
    reason: 'no-bound check must pass',
    make() {
      const t = buildToy({ order: ['F1', 'F2'] });
      const l = ledgerFor(t);
      const d = freeze(l, 'F2').details as { noBoundCheck: { exitCode: number; result: string } };
      d.noBoundCheck.exitCode = 1;
      d.noBoundCheck.result = 'fail';
      return { ledger: l, repo: t.root };
    },
  },
  {
    name: 'F4b frame records hash differs from the frame spec',
    expect: 'fail',
    reason: "frameRecordsSha256 differs from the frame spec's hash",
    make() {
      const t = buildToy({ order: ['F1', 'F2', 'F3', 'F4', 'F4b'] });
      const l = ledgerFor(t);
      (freeze(l, 'F4b').details as { frameRecordsSha256: string }).frameRecordsSha256 = sha256('x');
      return { ledger: l, repo: t.root };
    },
  },
];

export interface CaseOutcome {
  name: string;
  expect: 'pass' | 'fail';
  got: 'pass' | 'fail';
  ok: boolean;
  result: CheckResult;
}

export function runCase(c: Case): CaseOutcome {
  const { ledger, repo } = c.make();
  const result = checkLedger(ledger, { repo });
  const got = result.errors.length === 0 ? 'pass' : 'fail';
  const reasonOk = c.reason === undefined || result.errors.some((e) => e.includes(c.reason as string));
  return { name: c.name, expect: c.expect, got, ok: got === c.expect && reasonOk, result };
}

/** Runs every case, then removes the toy repositories. */
export function runCases(cases: Case[] = CASES): CaseOutcome[] {
  try {
    return cases.map(runCase);
  } finally {
    cleanupToys();
  }
}
