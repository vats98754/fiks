// The mock issue-tracker vendor (PLAN 5.1 "Tracker"). One version (v1); drifts are applied only by
// an injector in front of it, so the OpenAPI document it serves never changes. Admin endpoints
// (`/__admin/state`, `/__admin/reset`) expose ground truth for truth() and graders.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Catalog } from '@fiks/interfaces';
import OPENAPI from '../docs/openapi.json' with { type: 'json' };
import {
  type ExtendedIssue,
  ISSUE_STATES,
  type IssueState,
  NAME_RE,
  resolveCatalog,
  TRANSITIONS,
} from './catalog.ts';
import {
  applyNameEdit,
  commentView,
  initialState,
  issueView,
  parseNameEdit,
  type StoredComment,
  searchIssues,
  summaryView,
  type VendorEvent,
  type VendorState,
  type VendorVersion,
} from './model.ts';

export * from './model.ts';
export { OPENAPI };

/** Response header that carries the API version (date-style, as many real APIs do). */
export const VERSION_HEADER = 'tracker-api-version';
export const VERSION_DATES = { v1: '2026-01-01' } as const;

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

export interface Vendor {
  server: Server;
  state: VendorState;
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
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
