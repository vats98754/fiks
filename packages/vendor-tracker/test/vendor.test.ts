import { afterEach, describe, expect, test } from 'vitest';
import {
  CATALOG,
  createVendor,
  loadExtended,
  OPENAPI,
  PAGE_SIZE,
  parseCatalogMode,
  TRACKER_FROZEN_CLOCK,
  VERSION_HEADER,
  type Vendor,
  validateExtended,
} from '../src/index.ts';

const EXT = new URL('./fixtures/extended-sample.json', import.meta.url).pathname;
const now = () => new Date(TRACKER_FROZEN_CLOCK);
let vendor: Vendor | undefined;

async function start(opts: Parameters<typeof createVendor>[0] = {}) {
  vendor = createVendor({ now, ...opts });
  return vendor.listen();
}

afterEach(async () => {
  await vendor?.close();
  vendor = undefined;
});

const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { status: res.status, headers: res.headers, body: await res.json() };
};
const post = (url: string, body: unknown) =>
  call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('v1 endpoints', () => {
  test('search is paginated; following next_page yields every match exactly once', async () => {
    const base = await start();
    const first = await call(`${base}/issues`);
    expect(first.headers.get(VERSION_HEADER)).toBe('2026-01-01');
    expect(first.body.total).toBe(CATALOG.length);
    expect(first.body.items).toHaveLength(PAGE_SIZE);
    expect(first.body.next_page).toBe(2);
    const keys: string[] = [];
    let page: number | null = 1;
    while (page !== null) {
      const r = await call(`${base}/issues?page=${page}`);
      keys.push(...r.body.items.map((i: { key: string }) => i.key));
      page = r.body.next_page;
    }
    expect(keys).toEqual(CATALOG.map((i) => i.key));
    expect((await call(`${base}/issues?page=0`)).status).toBe(400);
    expect((await call(`${base}/issues?state=bogus`)).status).toBe(400);
  });

  test('filters and text search', async () => {
    const base = await start();
    const bugs = await call(`${base}/issues?type=bug&state=open`);
    expect(bugs.body.items.map((i: { key: string }) => i.key)).toEqual([
      'TRK-101',
      'TRK-108',
      'TRK-114',
      'TRK-117',
    ]);
    const login = await call(`${base}/issues?q=LOGIN`);
    expect(login.body.items.map((i: { key: string }) => i.key)).toEqual(['TRK-101']);
    const byKey = await call(`${base}/issues?q=trk-104`);
    expect(byKey.body.total).toBe(1);
  });

  test('issue, comments, writes and the admin state', async () => {
    const base = await start();
    const issue = await call(`${base}/issues/TRK-104`);
    expect(issue.body).toMatchObject({ key: 'TRK-104', comment_count: 4, story_points: 2 });
    expect((await call(`${base}/issues/TRK-999`)).status).toBe(404);
    const comments = await call(`${base}/issues/TRK-104/comments`);
    expect(comments.body.total).toBe(4);
    expect(comments.body.items[0]).toMatchObject({ id: 'cm-6', author: 'frank' });

    const added = await post(`${base}/issues/TRK-103/comments`, { body: 'On it.' });
    expect(added.status).toBe(201);
    expect(added.body).toEqual({
      id: 'cm-1001',
      issue_key: 'TRK-103',
      author: 'api',
      body: 'On it.',
      created_at: TRACKER_FROZEN_CLOCK,
    });
    expect((await post(`${base}/issues/TRK-103/comments`, { body: '  ' })).status).toBe(400);

    const moved = await post(`${base}/issues/TRK-103/transitions`, { to: 'in_progress' });
    expect(moved.body).toEqual({
      key: 'TRK-103',
      state: 'in_progress',
      previous_state: 'open',
      updated_at: TRACKER_FROZEN_CLOCK,
    });
    const refused = await post(`${base}/issues/TRK-103/transitions`, { to: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('invalid_transition');

    const labels = await post(`${base}/issues/TRK-103/labels`, { add: ['triaged', 'docs'], remove: ['api'] });
    expect(labels.body.labels).toEqual(['docs', 'triaged']);
    const who = await post(`${base}/issues/TRK-103/assignees`, { add: ['erin'] });
    expect(who.body.assignees).toEqual(['erin']);
    expect((await post(`${base}/issues/TRK-103/assignees`, {})).status).toBe(400);

    const admin = await call(`${base}/__admin/state`);
    expect(admin.body).toEqual(JSON.parse(JSON.stringify(vendor?.state)));
    expect(admin.body.events.map((e: { kind: string; ok: boolean }) => `${e.kind}:${e.ok}`)).toEqual([
      'comment:true',
      'transition:true',
      'transition:false',
      'labels:true',
      'assignees:true',
    ]);
    await post(`${base}/__admin/reset`, {});
    const reset = await call(`${base}/__admin/state`);
    expect(reset.body.events).toEqual([]);
    expect(reset.body.issues.find((i: { key: string }) => i.key === 'TRK-103').state).toBe('open');
    expect((await post(`${base}/issues/TRK-103/comments`, { body: 'x' })).body.id).toBe('cm-1001');
  });

  test('every catalogued timestamp lies before the frozen clock', () => {
    const clock = Date.parse(TRACKER_FROZEN_CLOCK);
    for (const i of CATALOG) {
      for (const t of [i.created_at, i.updated_at, ...i.comments.map((c) => c.created_at)]) {
        expect(Date.parse(t), i.key).toBeLessThan(clock);
      }
    }
  });

  test('the served OpenAPI document is docs/openapi.json and states no numeric bound', async () => {
    const base = await start();
    expect((await call(`${base}/openapi.json`)).body).toEqual(OPENAPI);
    expect(JSON.stringify(OPENAPI)).not.toMatch(
      /"(example|examples|minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/,
    );
  });
});

describe('--catalog option', () => {
  test('parseCatalogMode', () => {
    expect(parseCatalogMode(undefined)).toBe('original');
    expect(parseCatalogMode('extended-only')).toBe('extended-only');
    expect(() => parseCatalogMode('both')).toThrow(/catalog must be one of/);
  });

  test('extended-only serves none of the original entity ids', async () => {
    const base = await start({ catalog: 'extended-only', extended: EXT });
    const original = new Set(CATALOG.map((i) => i.key));
    const keys: string[] = [];
    let page: number | null = 1;
    while (page !== null) {
      const r = await call(`${base}/issues?page=${page}`);
      keys.push(...r.body.items.map((i: { key: string }) => i.key));
      page = r.body.next_page;
    }
    expect(keys).toEqual(['TX-A1', 'TX-A2', 'TX-A3', 'TX-B1', 'TX-B2']);
    expect(keys.filter((k) => original.has(k))).toEqual([]);
    for (const k of original) expect((await call(`${base}/issues/${k}`)).status, k).toBe(404);
    const state = (await call(`${base}/__admin/state`)).body;
    expect(state.issues.some((i: { key: string }) => original.has(i.key))).toBe(false);
    expect(state.comments.some((c: { issue_key: string }) => original.has(c.issue_key))).toBe(false);
    expect(state.comments.map((c: { id: string }) => c.id)).toEqual([
      'cm-tx-a1-1',
      'cm-tx-b1-1',
      'cm-tx-b1-2',
    ]);
  });

  test('all serves both catalogs; original comment ids are the same in every mode', async () => {
    const base = await start({ catalog: 'all', extended: EXT });
    expect((await call(`${base}/issues`)).body.total).toBe(CATALOG.length + 5);
    expect((await call(`${base}/issues/TRK-104/comments`)).body.items[0].id).toBe('cm-6');
    expect((await call(`${base}/issues/TX-B1`)).body.comment_count).toBe(2);
  });

  test('the loader keeps authorBatch and rejects ids outside the extended namespace', () => {
    const ext = loadExtended(EXT);
    expect(ext.map((e) => e.authorBatch)).toEqual(['b01', 'b01', 'b01', 'b02', 'b02']);
    expect(ext[2]?.comments).toEqual([]);
    const one = (patch: Record<string, unknown>) => [{ ...ext[0], ...patch }];
    expect(() => validateExtended(one({ key: 'TRK-101' }))).toThrow(/extended namespace/);
    expect(() => validateExtended(one({ authorBatch: undefined }))).toThrow(/authorBatch/);
    expect(() => validateExtended(one({ state: 'done' }))).toThrow(/state must be one of/);
    expect(() => validateExtended([ext[0], ext[0]])).toThrow(/duplicate key/);
    expect(() => createVendor({ catalog: 'extended-only', extended: '/nonexistent.json' })).toThrow(
      /not found/,
    );
  });
});
