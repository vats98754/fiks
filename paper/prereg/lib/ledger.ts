// Freeze-ledger checker (PLAN 5.2): schema, canonical freeze list and order, tag -> peeled commit,
// tree hash, strict ancestry and timestamp order along every "must precede" edge, file hashes at
// the tagged commit, external refs as peeled commits (never tag objects), and per-freeze details.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { checkFrameSpec } from './frame-spec.ts';
import { isAncestor, objectType, peel, sha256, showFile, tagExists, treeOf } from './git.ts';
import { type Schema, validate } from './mini-schema.ts';

export const LEDGER_SCHEMA_PATH = new URL('../freeze-ledger.schema.json', import.meta.url);

/** Canonical freezes, in ledger order, with their tags and "must precede" edges (PLAN 5.2). */
export const CANONICAL: readonly { id: string; tag: string; mustPrecede: string[] }[] = [
  { id: 'F1', tag: 'freeze-operators', mustPrecede: ['F2'] },
  // F2 must precede A0; A0's outputs are frozen at F4.
  { id: 'F2', tag: 'freeze-vocab', mustPrecede: ['F4'] },
  { id: 'F3', tag: 'freeze-analysis', mustPrecede: ['F5'] },
  { id: 'F4', tag: 'contracts-frozen-v1', mustPrecede: ['F4b'] },
  { id: 'F4b', tag: 'frame-frozen', mustPrecede: ['F5'] },
  // F5 must precede any blind drift (F6 seals them) and is amended by F8.
  { id: 'F5', tag: 'prereg-v1', mustPrecede: ['F6', 'F8'] },
  // F6 must precede R0, whose outputs are frozen at F7.
  { id: 'F6', tag: 'blind-sealed', mustPrecede: ['F7'] },
  // F7 must precede any verdict on the test split; F9 is built from R2 verdicts.
  { id: 'F7', tag: 'enum-frozen', mustPrecede: ['F9'] },
  // F8 must precede R2, whose outputs are frozen at F9.
  { id: 'F8', tag: 'prereg-v1.1', mustPrecede: ['F9'] },
  // F9 must precede the pool (frozen at F10), R3 and R4.
  { id: 'F9', tag: 'eligible', mustPrecede: ['F10'] },
  { id: 'F10', tag: 'pool-frozen', mustPrecede: [] },
];

/** External refs a recorded freeze must carry (name -> repo). */
const REQUIRED_EXTERNAL: Record<string, Record<string, string>> = {
  F2: { 'base-shop': 'vats98754/shop-mcp' },
  F4: { 'seed-tracker-v1': 'vats98754/tracker-mcp' },
  F6: { 'driftbench-blind': 'vats98754/driftbench-blind' },
};

/** Files a recorded freeze must hash (in record.files). */
const REQUIRED_FILES: Record<string, string[]> = {
  F4: ['paper/prereg/A0-RECORD.md'],
  F5: ['paper/prereg/PREREG.md', 'paper/prereg/REGISTRY.json'],
  F8: ['paper/prereg/K1-ADDENDUM.md'],
};

export interface ExternalRef {
  name: string;
  repo: string;
  localPath: string;
  ref: string;
  peeledCommit: string;
}

export interface FreezeRecord {
  peeledCommit: string;
  treeHash: string;
  timestamp: string;
  externalRefs: ExternalRef[];
  files: { path: string; sha256: string }[];
  note?: string;
}

export interface Freeze {
  id: string;
  tag: string;
  content: string;
  mustPrecede: string[];
  record: FreezeRecord | null;
  details: Record<string, unknown>;
}

export interface Ledger {
  $schema: string;
  schemaVersion: 1;
  description?: string;
  freezes: Freeze[];
}

export interface CheckOptions {
  /** The fiks repository (tags live here). */
  repo: string;
  /** Downgrade an unavailable external clone from an error to a warning. */
  allowMissingExternal?: boolean;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
  passes: string[];
}

export function loadLedgerSchema(): Schema {
  return JSON.parse(readFileSync(LEDGER_SCHEMA_PATH, 'utf8')) as Schema;
}

function defRef(name: string): Schema {
  return { $ref: `#/$defs/${name}` };
}

function hasNull(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) return v.some(hasNull);
  if (typeof v === 'object') return Object.values(v as object).some(hasNull);
  return false;
}

function fileAt(opts: CheckOptions, commit: string, path: string): Buffer | null {
  return showFile(opts.repo, commit, path);
}

function checkFileHash(
  opts: CheckOptions,
  r: CheckResult,
  id: string,
  commit: string,
  path: string,
  expected: string,
): void {
  const bytes = fileAt(opts, commit, path);
  if (bytes === null) {
    r.errors.push(`${id}: ${path} is not in the tagged commit ${commit.slice(0, 12)}`);
    return;
  }
  const got = sha256(bytes);
  if (got !== expected) r.errors.push(`${id}: sha256 of ${path} is ${got}, ledger says ${expected}`);
}

function checkExternal(opts: CheckOptions, r: CheckResult, id: string, ext: ExternalRef): void {
  const dir = isAbsolute(ext.localPath) ? ext.localPath : join(opts.repo, ext.localPath);
  if (!existsSync(dir)) {
    const msg = `${id}: external ${ext.name} (${ext.repo}): local clone ${ext.localPath} not found; cannot verify`;
    (opts.allowMissingExternal ? r.warnings : r.errors).push(msg);
    return;
  }
  const type = objectType(dir, ext.peeledCommit);
  if (type === 'tag') {
    const peeled = peel(dir, ext.peeledCommit);
    r.errors.push(
      `${id}: external ${ext.name} records ${ext.peeledCommit.slice(0, 12)}, which is a tag object; record its peeled commit ${peeled ?? '?'}`,
    );
    return;
  }
  if (type !== 'commit') {
    r.errors.push(
      `${id}: external ${ext.name}: ${ext.peeledCommit.slice(0, 12)} is ${type ?? 'absent'}, not a commit`,
    );
    return;
  }
  const resolved = peel(dir, ext.ref);
  if (resolved === null) {
    r.errors.push(`${id}: external ${ext.name}: ref ${ext.ref} does not resolve in ${ext.localPath}`);
  } else if (resolved !== ext.peeledCommit) {
    r.errors.push(
      `${id}: external ${ext.name}: ${ext.ref}^{commit} = ${resolved}, ledger says ${ext.peeledCommit}`,
    );
  } else {
    r.passes.push(
      `${id}: external ${ext.name} ${ext.ref}^{commit} = ${ext.peeledCommit.slice(0, 12)} (commit)`,
    );
  }
}

function checkDetails(opts: CheckOptions, r: CheckResult, schema: Schema, f: Freeze): void {
  const rec = f.record;
  const defs: Record<string, string> = {
    F2: 'f2Details',
    F4b: 'f4bDetails',
    F9: 'f9Details',
    F10: 'f10Details',
  };
  const def = defs[f.id];
  if (def !== undefined) {
    for (const e of validate(f.details, defRef(def), schema, `${f.id}.details`)) r.errors.push(e);
  }
  if (rec === null) return;
  if (def !== undefined && hasNull(f.details)) {
    r.errors.push(`${f.id}: recorded, but details still contain null slots`);
    return;
  }
  for (const [name, repo] of Object.entries(REQUIRED_EXTERNAL[f.id] ?? {})) {
    if (!rec.externalRefs.some((e) => e.name === name && e.repo === repo)) {
      r.errors.push(`${f.id}: recorded without the external ref ${name} (${repo})`);
    }
  }
  for (const path of REQUIRED_FILES[f.id] ?? []) {
    if (!rec.files.some((x) => x.path === path)) r.errors.push(`${f.id}: recorded without a hash of ${path}`);
  }
  if (f.id === 'F2') {
    const d = f.details as {
      docs: Record<string, { path: string; sha256: string }[]>;
      briefs: { kind: string; path: string; sha256: string }[];
      noBoundCheck: { exitCode: number; result: string };
    };
    for (const files of Object.values(d.docs)) {
      for (const x of files) checkFileHash(opts, r, 'F2', rec.peeledCommit, x.path, x.sha256);
    }
    const kinds = new Set(d.briefs.map((b) => b.kind));
    for (const k of ['catalog', 'contract-author', 'drift', 'evasive', 'benign', 'fixer', 'rater']) {
      if (!kinds.has(k)) r.errors.push(`F2: no hash for the ${k} brief`);
    }
    for (const b of d.briefs) checkFileHash(opts, r, 'F2', rec.peeledCommit, b.path, b.sha256);
    if (d.noBoundCheck.result !== 'pass' || d.noBoundCheck.exitCode !== 0) {
      r.errors.push('F2: the no-bound check must pass (exit 0) before F2 is recorded');
    }
  }
  if (f.id === 'F9' && (f.details as { traces: unknown[] }).traces.length === 0) {
    r.errors.push('F9: recorded with no frozen traces');
  }
  if (f.id === 'F4b') {
    const d = f.details as { frameSpecPath: string; frameSpecSha256: string; frameRecordsSha256: string };
    const d2 = f.details as { NE: number; crit: number; m: number };
    checkFileHash(opts, r, 'F4b', rec.peeledCommit, d.frameSpecPath, d.frameSpecSha256);
    const bytes = fileAt(opts, rec.peeledCommit, d.frameSpecPath);
    if (bytes !== null) {
      let spec: unknown;
      try {
        spec = JSON.parse(bytes.toString('utf8'));
      } catch {
        r.errors.push(`F4b: ${d.frameSpecPath} is not JSON`);
        return;
      }
      for (const e of checkFrameSpec(spec)) r.errors.push(`F4b: frame spec: ${e}`);
      const s = spec as { hash?: string; NE?: number; crit?: number; neRule?: { m?: number } };
      if (typeof s.hash === 'string' && s.hash.replace(/^sha256:/, '') !== d.frameRecordsSha256) {
        r.errors.push(`F4b: frameRecordsSha256 differs from the frame spec's hash`);
      }
      if (s.NE !== d2.NE || s.crit !== d2.crit || s.neRule?.m !== d2.m) {
        r.errors.push('F4b: NE, crit or m differ from the frame spec');
      }
    }
  }
}

export function checkLedger(ledger: unknown, opts: CheckOptions): CheckResult {
  const r: CheckResult = { errors: [], warnings: [], passes: [] };
  const schema = loadLedgerSchema();
  const schemaErrors = validate(ledger, schema);
  if (schemaErrors.length > 0) {
    r.errors.push(...schemaErrors.map((e) => `schema: ${e}`));
    return r;
  }
  const l = ledger as Ledger;

  // Canonical list, order, tags and edges (the edges may not be weakened).
  const ids = l.freezes.map((f) => f.id).join(',');
  const canon = CANONICAL.map((c) => c.id).join(',');
  if (ids !== canon) {
    r.errors.push(`freezes must be exactly ${canon} in this order; got ${ids}`);
    return r;
  }
  const byId = new Map(l.freezes.map((f) => [f.id, f]));
  for (const c of CANONICAL) {
    const f = byId.get(c.id) as Freeze;
    if (f.tag !== c.tag) r.errors.push(`${c.id}: tag must be ${c.tag}, got ${f.tag}`);
    if ([...f.mustPrecede].sort().join(',') !== [...c.mustPrecede].sort().join(',')) {
      r.errors.push(`${c.id}: mustPrecede must be [${c.mustPrecede}], got [${f.mustPrecede}]`);
    }
  }
  if (r.errors.length > 0) return r;

  // Per recorded freeze: tag, peeled commit, tree, timestamp, files, externals, details.
  for (const f of l.freezes) {
    const rec = f.record;
    const exists = tagExists(opts.repo, f.tag);
    if (rec === null) {
      if (exists) r.errors.push(`${f.id}: tag ${f.tag} exists but the ledger has no record for it`);
      checkDetails(opts, r, schema, f);
      continue;
    }
    if (!exists) {
      r.errors.push(`${f.id}: recorded, but tag ${f.tag} does not exist`);
      continue;
    }
    const type = objectType(opts.repo, rec.peeledCommit);
    if (type !== 'commit') {
      r.errors.push(
        `${f.id}: peeledCommit ${rec.peeledCommit.slice(0, 12)} is ${type ?? 'absent'}, not a commit (record ${f.tag}^{commit})`,
      );
      continue;
    }
    const peeled = peel(opts.repo, `refs/tags/${f.tag}`);
    if (peeled !== rec.peeledCommit) {
      r.errors.push(`${f.id}: ${f.tag}^{commit} = ${peeled}, ledger says ${rec.peeledCommit}`);
      continue;
    }
    const tree = treeOf(opts.repo, rec.peeledCommit);
    if (tree !== rec.treeHash)
      r.errors.push(`${f.id}: tree of ${f.tag} is ${tree}, ledger says ${rec.treeHash}`);
    if (Number.isNaN(Date.parse(rec.timestamp))) r.errors.push(`${f.id}: bad timestamp ${rec.timestamp}`);
    for (const x of rec.files) checkFileHash(opts, r, f.id, rec.peeledCommit, x.path, x.sha256);
    for (const ext of rec.externalRefs) checkExternal(opts, r, f.id, ext);
    checkDetails(opts, r, schema, f);
    r.passes.push(
      `${f.id}: ${f.tag}^{commit} = ${rec.peeledCommit.slice(0, 12)}, tree ${rec.treeHash.slice(0, 12)}`,
    );
  }

  // Order: along every edge a -> b with b recorded, a is recorded, a's commit is a strict
  // ancestor of b's, and a's timestamp is earlier.
  for (const c of CANONICAL) {
    const a = byId.get(c.id) as Freeze;
    for (const bid of c.mustPrecede) {
      const b = byId.get(bid) as Freeze;
      if (b.record === null) continue;
      if (a.record === null) {
        r.errors.push(`${bid} (${b.tag}) is recorded but ${c.id} (${a.tag}), which must precede it, is not`);
        continue;
      }
      const ac = a.record.peeledCommit;
      const bc = b.record.peeledCommit;
      if (ac === bc || !isAncestor(opts.repo, ac, bc)) {
        r.errors.push(
          `${c.id} (${a.tag}) must precede ${bid} (${b.tag}): ${ac.slice(0, 12)} is not a strict ancestor of ${bc.slice(0, 12)}`,
        );
      } else if (!(Date.parse(a.record.timestamp) < Date.parse(b.record.timestamp))) {
        r.errors.push(
          `${c.id} (${a.tag}) must precede ${bid} (${b.tag}): timestamp ${a.record.timestamp} is not earlier`,
        );
      } else {
        r.passes.push(`${c.id} -> ${bid}: strict ancestor, earlier timestamp`);
      }
    }
  }
  return r;
}
