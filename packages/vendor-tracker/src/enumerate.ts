// Tracker input enumeration (Domain.enumerate; PLAN 3.1 frame strata, 5.7). Deterministic for a
// given catalog and seed. Reads no contract.
import { createHash } from 'node:crypto';
import type { EnumerateOptions, EnumRow } from '@fiks/interfaces';
import {
  type CatalogIssue,
  type ExtendedIssue,
  ISSUE_STATES,
  ISSUE_TYPES,
  resolveCatalog,
  TRANSITIONS,
} from './catalog.ts';

/** Target size of the S-grid (PLAN 3.1: >= 200 queries per domain). */
export const TRACKER_GRID_SIZE = 200;

export const TRACKER_STRATA = ['S-ext', 'S-grid', 'S-write'] as const;

/** Tracker known-good search inputs: none are declared, so nothing is excluded from the grid. */
export const TRACKER_KNOWN_GOOD_QUERIES: readonly Record<string, unknown>[] = [];

function rng(seed: string | number): () => number {
  let a = createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], seed: string | number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const key = (...parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

/**
 * Candidate search inputs from the catalog: title word prefixes and word pairs, exact keys, every
 * type and state filter and their combinations, labels, assignees, and a few text x state pairs.
 */
export function gridCandidates(issues: readonly CatalogIssue[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  const add = (args: Record<string, unknown>) => seen.set(JSON.stringify(args), args);
  const words = new Set<string>();
  for (const i of issues) {
    const ws = i.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    ws.forEach((w, n) => {
      words.add(w);
      for (let len = 3; len < w.length; len++) add({ query: w.slice(0, len) });
      add({ query: w });
      const next = ws[n + 1];
      if (next) add({ query: `${w} ${next}` });
    });
    add({ query: i.key });
    for (const l of i.labels) add({ label: l });
    for (const a of i.assignees) add({ assignee: a });
  }
  for (const t of ISSUE_TYPES) {
    add({ type: t });
    for (const s of ISSUE_STATES) add({ type: t, state: s });
  }
  for (const s of ISSUE_STATES) {
    add({ state: s });
    for (const w of [...words].sort().slice(0, 12)) add({ query: w, state: s });
  }
  add({});
  for (const k of TRACKER_KNOWN_GOOD_QUERIES) seen.delete(JSON.stringify(k));
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}

/** The text of the S-write comment on `issueKey`. */
export const writeCommentBody = (issueKey: string) => `Status check on ${issueKey}: still relevant?`;

export interface TrackerEnumerateOptions extends EnumerateOptions {
  /** Extended entities (default: the committed extended catalog file). */
  extended?: readonly ExtendedIssue[] | string;
}

/**
 * S-ext: get_issue and list_comments for every catalog issue. S-grid: up to TRACKER_GRID_SIZE
 * seeded search inputs. S-write: per issue one add_comment followed by its list_comments, and one
 * transition (the first allowed move from the catalogued state) followed by its get_issue.
 */
export function trackerEnumerate(opts: TrackerEnumerateOptions): EnumRow[] {
  const issues = resolveCatalog(opts.catalog, opts.extended);
  const rows: EnumRow[] = [];
  const add = (stratum: string, tool: string, args: Record<string, unknown>, ...extra: unknown[]) =>
    rows.push({
      domain: 'tracker',
      stratum,
      tool,
      args,
      dedupeKey: key('tracker', stratum, tool, args, ...extra),
    });
  const want = (s: string) => !opts.stratum || opts.stratum === s;
  if (want('S-ext')) {
    for (const i of issues) {
      add('S-ext', 'get_issue', { key: i.key });
      add('S-ext', 'list_comments', { issue_key: i.key });
    }
  }
  if (want('S-grid')) {
    for (const args of shuffled(gridCandidates(issues), opts.seed).slice(0, TRACKER_GRID_SIZE)) {
      add('S-grid', 'search_issues', args);
    }
  }
  if (want('S-write')) {
    for (const i of issues) {
      add('S-write', 'add_comment', { issue_key: i.key, body: writeCommentBody(i.key) });
      add('S-write', 'list_comments', { issue_key: i.key }, 'after-comment');
      const to = TRANSITIONS[i.state][0] as string;
      add('S-write', 'transition_issue', { key: i.key, to });
      add('S-write', 'get_issue', { key: i.key }, 'after-transition');
    }
  }
  return rows;
}
