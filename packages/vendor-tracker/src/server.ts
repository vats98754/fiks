// The mock issue-tracker vendor (PLAN 5.1 "Tracker"). One version (v1); drifts are applied only by
// an injector in front of it, so the OpenAPI document it serves never changes. Admin endpoints
// (`/__admin/state`, `/__admin/reset`) expose ground truth for truth() and graders.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Catalog } from '@fiks/interfaces';
import OPENAPI from '../docs/openapi.json' with { type: 'json' };
import {
  type CatalogIssue,
  type ExtendedIssue,
  ISSUE_STATES,
  ISSUE_TYPES,
  type IssueState,
  type IssueType,
  NAME_RE,
  type Priority,
  resolveCatalog,
  TRANSITIONS,
} from './catalog.ts';

export { OPENAPI };

/** Response header that carries the API version (date-style, as many real APIs do). */
export const VERSION_HEADER = 'tracker-api-version';
export const VERSION_DATES = { v1: '2026-01-01' } as const;
export type VendorVersion = keyof typeof VERSION_DATES;

/** Issues per search page. Documented only as "paginated"; clients follow `next_page`. */
export const PAGE_SIZE = 10;

/** First id number for comments created through the API. */
export const FIRST_NEW_COMMENT = 1001;

/** Author recorded when a comment is created without one. */
export const DEFAULT_AUTHOR = 'api';

export interface VendorOptions {
  version?: VendorVersion;
  /** Which issues to serve (P8). Default `original`. */
  catalog?: Catalog;
  /** Extended entities, or the path of their JSON file (default: `extendedCatalogPath()`). */
  extended?: readonly ExtendedIssue[] | string;
  /** Clock for timestamps written by the API (comments, updated_at). Default: wall clock. */
  now?: () => Date;
}

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

export interface Vendor {
  server: Server;
  state: VendorState;
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
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

export function createVendor(opts: VendorOptions = {}): Vendor {
  const version: VendorVersion = opts.version ?? 'v1';
  if (version !== 'v1')
    throw new Error(`tracker vendor has only v1 (drifts come from an injector), got ${version}`);
  const now = opts.now ?? (() => new Date());
  const catalog = opts.catalog ?? 'original';
  const issues = resolveCatalog(catalog, opts.extended);
  let nextComment = FIRST_NEW_COMMENT;
  const state: VendorState = initialState(issues, catalog);

  function reset() {
    const fresh = initialState(issues, catalog);
    state.issues = fresh.issues;
    state.comments = fresh.comments;
    state.events = [];
    nextComment = FIRST_NEW_COMMENT;
  }

  const findIssue = (key: string) => state.issues.find((i) => i.key === key);
  const event = (e: Omit<VendorEvent, 'seq' | 'at'>, at: string) => {
    state.events.push({ seq: state.events.length + 1, at, ...e });
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://tracker.local');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', [VERSION_HEADER]: VERSION_DATES[version] });
      res.end(JSON.stringify(body));
    };
    const error = (status: number, code: string, message: string) => send(status, { error: code, message });
    const method = req.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (method === 'GET' && url.pathname === '/openapi.json') return send(200, OPENAPI);
    if (method === 'GET' && url.pathname === '/__admin/state') return send(200, state);
    if (method === 'POST' && url.pathname === '/__admin/reset') {
      reset();
      return send(200, { ok: true });
    }

    if (parts[0] !== 'issues') return error(404, 'not_found', `No route for ${method} ${url.pathname}`);

    if (method === 'GET' && parts.length === 1) {
      const p = url.searchParams;
      const opt = (k: string) => p.get(k) ?? undefined;
      const rawPage = p.get('page') ?? '1';
      const page = Number(rawPage);
      if (!/^\d+$/.test(rawPage) || page < 1)
        return error(400, 'invalid_page', 'page must be a positive integer');
      const matches = searchIssues(state.issues, {
        q: opt('q'),
        type: opt('type'),
        state: opt('state'),
        label: opt('label'),
        assignee: opt('assignee'),
      });
      if (typeof matches === 'string') return error(400, 'invalid_filter', matches);
      const start = (page - 1) * PAGE_SIZE;
      return send(200, {
        items: matches.slice(start, start + PAGE_SIZE).map(summaryView),
        total: matches.length,
        page,
        next_page: start + PAGE_SIZE < matches.length ? page + 1 : null,
      });
    }

    const key = parts[1] as string;
    const issue = findIssue(key);
    if (parts.length >= 2 && !issue) return error(404, 'not_found', `Unknown issue ${key}.`);
    if (!issue) return error(404, 'not_found', `No route for ${method} ${url.pathname}`);

    if (method === 'GET' && parts.length === 2) return send(200, issueView(issue, state.comments));

    if (parts.length === 3 && parts[2] === 'comments') {
      if (method === 'GET') {
        const items = state.comments.filter((c) => c.issue_key === key).map(commentView);
        return send(200, { issue_key: key, items, total: items.length });
      }
      if (method === 'POST') {
        const body = (await readJson(req)) as { body?: unknown; author?: unknown } | null;
        if (typeof body?.body !== 'string' || !body.body.trim()) {
          return error(400, 'invalid_comment', 'body must be a non-empty string');
        }
        const author = body.author ?? DEFAULT_AUTHOR;
        if (typeof author !== 'string' || !NAME_RE.test(author)) {
          return error(400, 'invalid_comment', 'author must be a lower-case name');
        }
        const at = now().toISOString();
        const comment: StoredComment = {
          id: `cm-${nextComment++}`,
          issue_key: key,
          author,
          body: body.body,
          created_at: at,
        };
        state.comments.push(comment);
        issue.updated_at = at;
        event({ kind: 'comment', key, ok: true, from: comment.id }, at);
        return send(201, commentView(comment));
      }
    }

    if (method === 'POST' && parts.length === 3 && parts[2] === 'transitions') {
      const body = (await readJson(req)) as { to?: unknown } | null;
      const to = body?.to;
      if (typeof to !== 'string' || !(ISSUE_STATES as readonly string[]).includes(to)) {
        return error(400, 'invalid_state', `to must be one of ${ISSUE_STATES.join(', ')}`);
      }
      const at = now().toISOString();
      const from = issue.state;
      if (!TRANSITIONS[from].includes(to as IssueState)) {
        event({ kind: 'transition', key, ok: false, from, to }, at);
        return error(409, 'invalid_transition', `Cannot move ${key} from ${from} to ${to}.`);
      }
      issue.state = to as IssueState;
      issue.updated_at = at;
      event({ kind: 'transition', key, ok: true, from, to }, at);
      return send(200, { key, state: issue.state, previous_state: from, updated_at: at });
    }

    if (method === 'POST' && parts.length === 3 && (parts[2] === 'labels' || parts[2] === 'assignees')) {
      const field = parts[2] as 'labels' | 'assignees';
      const edit = parseNameEdit(await readJson(req));
      if (typeof edit === 'string') return error(400, `invalid_${field}`, edit);
      const at = now().toISOString();
      issue[field] = applyNameEdit(issue[field], edit.add, edit.remove);
      issue.updated_at = at;
      event({ kind: field, key, ok: true }, at);
      return send(200, { key, [field]: [...issue[field]], updated_at: at });
    }

    return error(404, 'not_found', `No route for ${method} ${url.pathname}`);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json', [VERSION_HEADER]: VERSION_DATES[version] });
      res.end(JSON.stringify({ error: 'internal', message: String(e) }));
    });
  });

  return {
    server,
    state,
    reset,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    return null;
  }
}
