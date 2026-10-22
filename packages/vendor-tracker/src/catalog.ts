// The tracker's issue catalog: the original issues (the S-dev catalog), the extended-catalog
// loader for the blind A0 entities (PLAN 3.1, `authorBatch` kept), and the `--catalog` option.
import { readFileSync } from 'node:fs';
import type { Catalog } from '@fiks/interfaces';

export type { Catalog } from '@fiks/interfaces';

export const ISSUE_TYPES = ['bug', 'task', 'feature'] as const;
export const ISSUE_STATES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueState = (typeof ISSUE_STATES)[number];
export type Priority = (typeof PRIORITIES)[number];

/** Allowed state transitions (the workflow). Any other `to` is rejected with 409. */
export const TRANSITIONS: Readonly<Record<IssueState, readonly IssueState[]>> = {
  open: ['in_progress', 'closed'],
  in_progress: ['open', 'resolved'],
  resolved: ['open', 'closed'],
  closed: ['open'],
};

/** A comment as the catalog seeds it (the vendor assigns `id` and `issue_key` on load). */
export interface SeedComment {
  author: string;
  body: string;
  created_at: string;
}

export interface Issue {
  /** `TRK-<n>` in the original catalog, `TX-...` in the extended one. */
  key: string;
  title: string;
  type: IssueType;
  state: IssueState;
  priority: Priority;
  labels: string[];
  assignees: string[];
  reporter: string;
  /** Estimate in story points, or null when not estimated. */
  story_points: number | null;
  created_at: string;
  updated_at: string;
  comments: SeedComment[];
}

/** An entity of the blind-extended catalog (PLAN 3.1): authored in batches, in its own id space. */
export interface ExtendedIssue extends Issue {
  /** The authoring batch the entity came from (kept for the batch-cluster bootstrap). */
  authorBatch: string;
}

export type CatalogIssue = Issue | ExtendedIssue;

const c = (author: string, created_at: string, body: string): SeedComment => ({ author, body, created_at });

/** The original catalog (S-dev). Every timestamp lies before the domain's frozen clock. */
export const CATALOG: readonly Issue[] = [
  {
    key: 'TRK-101',
    title: 'Login page times out behind the corporate proxy',
    type: 'bug',
    state: 'open',
    priority: 'high',
    labels: ['frontend', 'regression'],
    assignees: ['alice'],
    reporter: 'erin',
    story_points: 3,
    created_at: '2026-07-02T09:14:00.000Z',
    updated_at: '2026-09-21T16:40:00.000Z',
    comments: [
      c('erin', '2026-07-02T09:20:00.000Z', 'Reproduced on two laptops; works on the guest network.'),
      c('alice', '2026-07-03T11:05:00.000Z', 'The proxy strips the upgrade header. Looking into a fallback.'),
      c('bob', '2026-09-21T16:40:00.000Z', 'Customer escalation came in again this morning.'),
    ],
  },
  {
    key: 'TRK-102',
    title: 'Add CSV export to the billing report',
    type: 'feature',
    state: 'in_progress',
    priority: 'medium',
    labels: ['backend', 'api'],
    assignees: ['bob', 'carol'],
    reporter: 'dan',
    story_points: 5,
    created_at: '2026-07-05T13:30:00.000Z',
    updated_at: '2026-09-18T10:02:00.000Z',
    comments: [
      c('dan', '2026-07-05T13:31:00.000Z', 'Finance wants the same columns as the on-screen table.'),
      c('carol', '2026-09-18T10:02:00.000Z', 'Streaming writer is in review.'),
    ],
  },
  {
    key: 'TRK-103',
    title: 'Document the webhook retry policy',
    type: 'task',
    state: 'open',
    priority: 'low',
    labels: ['docs', 'api'],
    assignees: [],
    reporter: 'carol',
    story_points: 1,
    created_at: '2026-07-08T08:00:00.000Z',
    updated_at: '2026-07-08T08:00:00.000Z',
    comments: [],
  },
  {
    key: 'TRK-104',
    title: 'Search results skip archived projects',
    type: 'bug',
    state: 'resolved',
    priority: 'medium',
    labels: ['backend', 'regression'],
    assignees: ['dan'],
    reporter: 'frank',
    story_points: 2,
    created_at: '2026-07-11T15:45:00.000Z',
    updated_at: '2026-09-02T12:00:00.000Z',
    comments: [
      c(
        'frank',
        '2026-07-11T15:50:00.000Z',
        'Archived projects vanished from search after the index rebuild.',
      ),
      c('dan', '2026-08-29T09:12:00.000Z', 'Root cause: the archive flag was indexed as a string.'),
      c('dan', '2026-09-02T12:00:00.000Z', 'Fixed in the nightly; please verify.'),
      c('frank', '2026-09-02T14:30:00.000Z', 'Verified on staging.'),
    ],
  },
  {
    key: 'TRK-105',
    title: 'Dark mode for the dashboard',
    type: 'feature',
    state: 'open',
    priority: 'low',
    labels: ['frontend', 'ux'],
    assignees: [],
    reporter: 'alice',
    story_points: 8,
    created_at: '2026-07-14T10:10:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    comments: [c('erin', '2026-08-01T09:00:00.000Z', 'Design tokens are ready for this.')],
  },
  {
    key: 'TRK-106',
    title: 'Rotate the staging database credentials',
    type: 'task',
    state: 'closed',
    priority: 'urgent',
    labels: ['security', 'infra'],
    assignees: ['frank'],
    reporter: 'frank',
    story_points: 1,
    created_at: '2026-07-15T07:00:00.000Z',
    updated_at: '2026-07-16T18:20:00.000Z',
    comments: [c('frank', '2026-07-16T18:20:00.000Z', 'Rotated and the old secret revoked.')],
  },
  {
    key: 'TRK-107',
    title: 'Upload fails for files with spaces in the name',
    type: 'bug',
    state: 'in_progress',
    priority: 'high',
    labels: ['backend', 'api'],
    assignees: ['carol'],
    reporter: 'bob',
    story_points: 2,
    created_at: '2026-07-20T12:25:00.000Z',
    updated_at: '2026-09-25T08:45:00.000Z',
    comments: [
      c('bob', '2026-07-20T12:26:00.000Z', 'The signed URL is built before the name is encoded.'),
      c('carol', '2026-09-25T08:45:00.000Z', 'Patch ready; adding tests for unicode names too.'),
    ],
  },
  {
    key: 'TRK-108',
    title: 'Slow first paint on the projects list',
    type: 'bug',
    state: 'open',
    priority: 'medium',
    labels: ['frontend', 'perf'],
    assignees: ['alice', 'erin'],
    reporter: 'dan',
    story_points: 5,
    created_at: '2026-07-22T16:00:00.000Z',
    updated_at: '2026-09-10T11:11:00.000Z',
    comments: [c('alice', '2026-09-10T11:11:00.000Z', 'Most of the time goes to the avatar requests.')],
  },
  {
    key: 'TRK-109',
    title: 'Add an audit log for permission changes',
    type: 'feature',
    state: 'open',
    priority: 'high',
    labels: ['security', 'backend'],
    assignees: ['bob'],
    reporter: 'frank',
    story_points: 13,
    created_at: '2026-07-25T09:40:00.000Z',
    updated_at: '2026-09-15T15:15:00.000Z',
    comments: [
      c('frank', '2026-07-25T09:41:00.000Z', 'Required for the compliance review next quarter.'),
      c('bob', '2026-09-15T15:15:00.000Z', 'Schema draft shared in the design doc.'),
    ],
  },
  {
    key: 'TRK-110',
    title: 'Clean up unused feature flags',
    type: 'task',
    state: 'resolved',
    priority: 'low',
    labels: ['infra'],
    assignees: ['erin'],
    reporter: 'erin',
    story_points: 2,
    created_at: '2026-07-28T11:00:00.000Z',
    updated_at: '2026-08-20T17:30:00.000Z',
    comments: [],
  },
  {
    key: 'TRK-111',
    title: 'Password reset email is sent twice',
    type: 'bug',
    state: 'closed',
    priority: 'medium',
    labels: ['backend', 'security'],
    assignees: ['dan'],
    reporter: 'carol',
    story_points: 1,
    created_at: '2026-08-01T08:30:00.000Z',
    updated_at: '2026-08-12T10:00:00.000Z',
    comments: [
      c('carol', '2026-08-01T08:31:00.000Z', 'Seen for accounts with two verified addresses.'),
      c('dan', '2026-08-12T10:00:00.000Z', 'Deduplicated at the queue; closing.'),
    ],
  },
  {
    key: 'TRK-112',
    title: 'Keyboard shortcuts for the issue board',
    type: 'feature',
    state: 'in_progress',
    priority: 'low',
    labels: ['frontend', 'ux'],
    assignees: ['erin'],
    reporter: 'alice',
    story_points: 3,
    created_at: '2026-08-04T14:00:00.000Z',
    updated_at: '2026-09-27T13:00:00.000Z',
    comments: [c('erin', '2026-09-27T13:00:00.000Z', 'First set: j/k to move, x to select.')],
  },
  {
    key: 'TRK-113',
    title: 'Migrate the build cache to the new bucket',
    type: 'task',
    state: 'open',
    priority: 'medium',
    labels: ['infra'],
    assignees: ['frank'],
    reporter: 'bob',
    story_points: null,
    created_at: '2026-08-09T10:20:00.000Z',
    updated_at: '2026-08-09T10:20:00.000Z',
    comments: [],
  },
  {
    key: 'TRK-114',
    title: 'Timezone shown wrong in the activity feed',
    type: 'bug',
    state: 'open',
    priority: 'low',
    labels: ['frontend', 'good-first-issue'],
    assignees: [],
    reporter: 'erin',
    story_points: 1,
    created_at: '2026-08-13T19:05:00.000Z',
    updated_at: '2026-09-01T09:30:00.000Z',
    comments: [
      c('erin', '2026-08-13T19:06:00.000Z', 'Entries use the server timezone instead of the viewer.'),
      c('alice', '2026-09-01T09:30:00.000Z', 'Good first issue: the formatter already takes a zone.'),
    ],
  },
  {
    key: 'TRK-115',
    title: 'Rate limit the public search API',
    type: 'feature',
    state: 'resolved',
    priority: 'high',
    labels: ['api', 'security', 'perf'],
    assignees: ['carol', 'dan'],
    reporter: 'frank',
    story_points: 8,
    created_at: '2026-08-18T09:00:00.000Z',
    updated_at: '2026-09-24T18:00:00.000Z',
    comments: [
      c('frank', '2026-08-18T09:02:00.000Z', 'One tenant sent a burst that slowed everyone down.'),
      c('carol', '2026-09-20T10:00:00.000Z', 'Token bucket per API key, configurable per plan.'),
      c('dan', '2026-09-24T18:00:00.000Z', 'Rolled out to all regions.'),
    ],
  },
  {
    key: 'TRK-116',
    title: 'Write the onboarding guide for new contributors',
    type: 'task',
    state: 'in_progress',
    priority: 'medium',
    labels: ['docs', 'good-first-issue'],
    assignees: ['alice'],
    reporter: 'dan',
    story_points: 3,
    created_at: '2026-08-22T13:15:00.000Z',
    updated_at: '2026-09-19T12:45:00.000Z',
    comments: [c('alice', '2026-09-19T12:45:00.000Z', 'Draft covers setup and the review process.')],
  },
  {
    key: 'TRK-117',
    title: 'Notifications arrive after the issue is closed',
    type: 'bug',
    state: 'open',
    priority: 'urgent',
    labels: ['backend', 'regression'],
    assignees: ['bob'],
    reporter: 'alice',
    story_points: 5,
    created_at: '2026-09-03T07:50:00.000Z',
    updated_at: '2026-09-28T09:10:00.000Z',
    comments: [
      c('alice', '2026-09-03T07:51:00.000Z', 'Close events are processed after the notification batch.'),
      c('bob', '2026-09-28T09:10:00.000Z', 'Moving the close handler ahead of the batch job.'),
    ],
  },
  {
    key: 'TRK-118',
    title: 'Bulk edit labels from the issue list',
    type: 'feature',
    state: 'closed',
    priority: 'medium',
    labels: ['frontend', 'ux'],
    assignees: ['erin'],
    reporter: 'carol',
    story_points: 5,
    created_at: '2026-09-06T11:30:00.000Z',
    updated_at: '2026-09-26T16:00:00.000Z',
    comments: [c('carol', '2026-09-26T16:00:00.000Z', 'Shipped behind the board flag.')],
  },
  {
    key: 'TRK-119',
    title: 'Upgrade the TLS library on the edge proxies',
    type: 'task',
    state: 'open',
    priority: 'high',
    labels: ['security', 'infra'],
    assignees: [],
    reporter: 'frank',
    story_points: 2,
    created_at: '2026-09-12T08:05:00.000Z',
    updated_at: '2026-09-12T08:05:00.000Z',
    comments: [],
  },
  {
    key: 'TRK-120',
    title: 'Attachment previews crash on large images',
    type: 'bug',
    state: 'in_progress',
    priority: 'medium',
    labels: ['frontend', 'perf'],
    assignees: ['carol'],
    reporter: 'bob',
    story_points: 3,
    created_at: '2026-09-17T10:40:00.000Z',
    updated_at: '2026-09-29T14:20:00.000Z',
    comments: [
      c('bob', '2026-09-17T10:41:00.000Z', 'The tab runs out of memory decoding the full image.'),
      c('carol', '2026-09-29T14:20:00.000Z', 'Generating thumbnails server-side instead.'),
    ],
  },
];

/** Issue keys in the original catalog. */
export const ORIGINAL_KEY = /^TRK-\d+$/;
/** Extended keys live in their own namespace (`TX-...`), never the original `TRK-<n>` one. */
export const EXTENDED_KEY = /^TX-[A-Z0-9][A-Z0-9-]*$/;
/** Labels, assignees and authors: lower-case letters, digits, `:`, `_`, `.` and `-`. */
export const NAME_RE = /^[a-z0-9][a-z0-9:_.-]*$/;

export function findIssue(key: string, issues: readonly CatalogIssue[] = CATALOG): CatalogIssue | undefined {
  return issues.find((i) => i.key === key);
}

// --- Catalog option (P8): original | extended-only | all ------------------------------------

export const CATALOG_MODES: readonly Catalog[] = ['original', 'extended-only', 'all'];

/** Where the A0 catalog author's entities are committed (override: TRACKER_EXTENDED_CATALOG). */
export const DEFAULT_EXTENDED_CATALOG = new URL('../catalog/extended.json', import.meta.url).pathname;

export function extendedCatalogPath(): string {
  return process.env.TRACKER_EXTENDED_CATALOG ?? DEFAULT_EXTENDED_CATALOG;
}

export function parseCatalogMode(raw: string | undefined): Catalog {
  const mode = raw ?? 'original';
  if (!(CATALOG_MODES as readonly string[]).includes(mode)) {
    throw new Error(`catalog must be one of ${CATALOG_MODES.join(', ')}, got ${JSON.stringify(raw)}`);
  }
  return mode as Catalog;
}

const isIso = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/**
 * Validates extended entities: issue fields as in the original catalog plus `authorBatch`, unique
 * keys in the extended namespace. No value bound is checked (the brief states none).
 */
export function validateExtended(raw: unknown, source = 'extended catalog'): ExtendedIssue[] {
  const list = Array.isArray(raw) ? raw : (raw as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(list)) throw new Error(`${source}: expected an array or {"entities": [...]}`);
  const seen = new Set<string>();
  return list.map((e: unknown, i: number) => {
    const x = (e ?? {}) as Record<string, unknown>;
    const where = `${source}[${i}]`;
    const str = (k: string) => {
      if (typeof x[k] !== 'string' || !(x[k] as string).trim())
        throw new Error(`${where}: ${k} must be a string`);
      return x[k] as string;
    };
    const oneOf = <T extends string>(k: string, values: readonly T[]): T => {
      const v = str(k);
      if (!(values as readonly string[]).includes(v))
        throw new Error(`${where}: ${k} must be one of ${values.join(', ')}`);
      return v as T;
    };
    const names = (k: string) => {
      const v = x[k] ?? [];
      if (!Array.isArray(v) || !v.every((n) => typeof n === 'string' && NAME_RE.test(n))) {
        throw new Error(`${where}: ${k} must be an array of lower-case names`);
      }
      return [...v] as string[];
    };
    const instant = (k: string, v: unknown = x[k]) => {
      if (!isIso(v)) throw new Error(`${where}: ${k} must be an ISO-8601 UTC instant`);
      return v;
    };
    const key = str('key');
    if (!EXTENDED_KEY.test(key)) {
      throw new Error(`${where}: key ${JSON.stringify(key)} is outside the extended namespace (TX-...)`);
    }
    if (seen.has(key)) throw new Error(`${where}: duplicate key ${key}`);
    seen.add(key);
    const sp = x.story_points ?? null;
    if (sp !== null && (typeof sp !== 'number' || !Number.isFinite(sp))) {
      throw new Error(`${where}: story_points must be a number or null`);
    }
    const reporter = str('reporter');
    if (!NAME_RE.test(reporter)) throw new Error(`${where}: reporter must be a lower-case name`);
    const rawComments = x.comments ?? [];
    if (!Array.isArray(rawComments)) throw new Error(`${where}: comments must be an array`);
    const comments = rawComments.map((cm: unknown, j: number) => {
      const y = (cm ?? {}) as Record<string, unknown>;
      if (typeof y.author !== 'string' || !NAME_RE.test(y.author)) {
        throw new Error(`${where}.comments[${j}]: author must be a lower-case name`);
      }
      if (typeof y.body !== 'string' || !y.body.trim())
        throw new Error(`${where}.comments[${j}]: body must be a string`);
      return {
        author: y.author,
        body: y.body,
        created_at: instant(`comments[${j}].created_at`, y.created_at),
      };
    });
    return {
      key,
      title: str('title'),
      type: oneOf('type', ISSUE_TYPES),
      state: oneOf('state', ISSUE_STATES),
      priority: oneOf('priority', PRIORITIES),
      labels: names('labels'),
      assignees: names('assignees'),
      reporter,
      story_points: sp as number | null,
      created_at: instant('created_at'),
      updated_at: instant('updated_at'),
      comments,
      authorBatch: str('authorBatch'),
    };
  });
}

const extendedCache = new Map<string, ExtendedIssue[]>();

/** Extended entities from a JSON file (default: `extendedCatalogPath()`), validated and cached. */
export function loadExtended(file = extendedCatalogPath()): ExtendedIssue[] {
  let hit = extendedCache.get(file);
  if (!hit) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`extended catalog ${file} not found (set TRACKER_EXTENDED_CATALOG or pass extended)`);
    }
    hit = validateExtended(JSON.parse(text), file);
    extendedCache.set(file, hit);
  }
  return hit;
}

/** The issues a vendor serves for `mode`. `original` is exactly `CATALOG`. */
export function resolveCatalog(
  mode: Catalog,
  extended?: readonly ExtendedIssue[] | string,
): readonly CatalogIssue[] {
  if (mode === 'original') return CATALOG;
  const ext = typeof extended === 'string' || extended === undefined ? loadExtended(extended) : extended;
  return mode === 'extended-only' ? ext : [...CATALOG, ...ext];
}
