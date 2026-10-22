// The tracker vendor's data model and wire views: plain JSON state, the views each endpoint
// returns, search and name-edit semantics. Shared by the HTTP server and truth() (no I/O here).
import type { Catalog } from '@fiks/interfaces';
import {
  type CatalogIssue,
  ISSUE_STATES,
  ISSUE_TYPES,
  type IssueState,
  type IssueType,
  NAME_RE,
  type Priority,
  resolveCatalog,
} from './catalog.ts';

export type VendorVersion = 'v1';

export interface StoredIssue {
  key: string;
  title: string;
  type: IssueType;
  state: IssueState;
  priority: Priority;
  labels: string[];
  assignees: string[];
  reporter: string;
  story_points: number | null;
  created_at: string;
  updated_at: string;
}

export interface StoredComment {
  id: string;
  issue_key: string;
  author: string;
  body: string;
  created_at: string;
}

/** One mutating request against a known issue, in order (also failed transitions). */
export interface VendorEvent {
  seq: number;
  kind: 'comment' | 'transition' | 'labels' | 'assignees';
  key: string;
  ok: boolean;
  at: string;
  /** transition: the state before; comment: the new comment id. */
  from?: string;
  /** transition: the requested state. */
  to?: string;
}

/** Ground truth. Plain JSON: `/__admin/state` returns exactly this object. */
export interface VendorState {
  version: VendorVersion;
  /** Always empty: the vendor has one behaviour; drifts come from an injector. */
  drifts: string[];
  catalog: Catalog;
  issues: StoredIssue[];
  comments: StoredComment[];
  events: VendorEvent[];
}

/** The comment id of the j-th seed comment of `issue` (stable across catalog modes). */
export function seedCommentIds(issues: readonly CatalogIssue[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let n = 0;
  for (const issue of issues) {
    const extended = 'authorBatch' in issue;
    out.set(
      issue.key,
      issue.comments.map((_, j) => (extended ? `cm-${issue.key.toLowerCase()}-${j + 1}` : `cm-${++n}`)),
    );
  }
  return out;
}

// Original ids are numbered over the original catalog only, so they are the same in every mode.
const ORIGINAL_IDS = seedCommentIds(resolveCatalog('original'));

/** Initial state for a catalog: issues without comments, then every seed comment. */
export function initialState(issues: readonly CatalogIssue[], catalog: Catalog): VendorState {
  const ext = seedCommentIds(issues.filter((i) => 'authorBatch' in i));
  const state: VendorState = { version: 'v1', drifts: [], catalog, issues: [], comments: [], events: [] };
  for (const issue of issues) {
    const { comments, ...rest } = issue;
    const stored: StoredIssue = {
      key: rest.key,
      title: rest.title,
      type: rest.type,
      state: rest.state,
      priority: rest.priority,
      labels: [...rest.labels],
      assignees: [...rest.assignees],
      reporter: rest.reporter,
      story_points: rest.story_points,
      created_at: rest.created_at,
      updated_at: rest.updated_at,
    };
    state.issues.push(stored);
    const ids = ORIGINAL_IDS.get(issue.key) ?? ext.get(issue.key) ?? [];
    comments.forEach((cm, j) => {
      state.comments.push({
        id: ids[j] as string,
        issue_key: issue.key,
        author: cm.author,
        body: cm.body,
        created_at: cm.created_at,
      });
    });
  }
  return state;
}

// --- Wire views (shared with truth() through the tool-level mapping) --------------------------

/** `GET /issues/{key}` body. */
export function issueView(issue: StoredIssue, comments: readonly StoredComment[]) {
  return {
    key: issue.key,
    title: issue.title,
    type: issue.type,
    state: issue.state,
    priority: issue.priority,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    reporter: issue.reporter,
    story_points: issue.story_points,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    comment_count: comments.filter((c) => c.issue_key === issue.key).length,
  };
}

/** One `GET /issues` item. */
export function summaryView(issue: StoredIssue) {
  return {
    key: issue.key,
    title: issue.title,
    type: issue.type,
    state: issue.state,
    priority: issue.priority,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    updated_at: issue.updated_at,
  };
}

export function commentView(c: StoredComment) {
  return { id: c.id, issue_key: c.issue_key, author: c.author, body: c.body, created_at: c.created_at };
}

export interface SearchFilters {
  q?: string;
  type?: string;
  state?: string;
  label?: string;
  assignee?: string;
}

/** Search semantics: `q` is a case-insensitive substring of the title or the exact key; filters are exact. */
export function searchIssues(issues: readonly StoredIssue[], f: SearchFilters): StoredIssue[] | string {
  if (f.type !== undefined && !(ISSUE_TYPES as readonly string[]).includes(f.type)) return 'unknown type';
  if (f.state !== undefined && !(ISSUE_STATES as readonly string[]).includes(f.state)) return 'unknown state';
  const q = (f.q ?? '').trim().toLowerCase();
  return issues.filter(
    (i) =>
      (!q || i.title.toLowerCase().includes(q) || i.key.toLowerCase() === q) &&
      (f.type === undefined || i.type === f.type) &&
      (f.state === undefined || i.state === f.state) &&
      (f.label === undefined || i.labels.includes(f.label)) &&
      (f.assignee === undefined || i.assignees.includes(f.assignee)),
  );
}

/** Applies `{add, remove}` to a name list: removals first, then additions not yet present. */
export function applyNameEdit(current: readonly string[], add: readonly string[], remove: readonly string[]) {
  const out = current.filter((n) => !remove.includes(n));
  for (const n of add) if (!out.includes(n)) out.push(n);
  return out;
}

/** Parses `{add?: string[], remove?: string[]}`; at least one name in total. */
export function parseNameEdit(body: unknown): { add: string[]; remove: string[] } | string {
  const b = (body ?? {}) as { add?: unknown; remove?: unknown };
  const list = (v: unknown) =>
    v === undefined
      ? []
      : Array.isArray(v) && v.every((n) => typeof n === 'string' && NAME_RE.test(n))
        ? v
        : null;
  const add = list(b.add);
  const remove = list(b.remove);
  if (add === null || remove === null) return 'add and remove must be arrays of lower-case names';
  if (add.length + remove.length === 0) return 'nothing to change';
  return { add: add as string[], remove: remove as string[] };
}
