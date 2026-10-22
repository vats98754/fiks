// truth() on 100 seeded random calls through the real tracker-mcp server (pinned clone) against
// vendor v1: (1) truth from the in-process state equals truth from the /__admin/state JSON;
// (2) both equal an independent expectation written here from the admin state and the docs;
// (3) on v1 the server's output equals truth() for every call (no mismatches), covering every tool.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  createVendor,
  TRACKER_FROZEN_CLOCK,
  TRACKER_TOOLS,
  trackerDomain,
  trackerTruth,
} from '../src/index.ts';
import { type Recorder, startRecorder } from '../src/record.ts';
import { randomCalls } from './support/calls.ts';

interface AdminIssue {
  key: string;
  title: string;
  type: string;
  state: string;
  priority: string;
  labels: string[];
  assignees: string[];
  reporter: string;
  story_points: number | null;
  created_at: string;
  updated_at: string;
}
interface AdminState {
  issues: AdminIssue[];
  comments: { id: string; issue_key: string; author: string; body: string; created_at: string }[];
  events: { kind: string; key: string; ok: boolean; from?: string; to?: string }[];
}

const NAME = /^[a-z0-9][a-z0-9:_.-]*$/;
const STATES = ['open', 'in_progress', 'resolved', 'closed'];
const TYPES = ['bug', 'task', 'feature'];

/** Independent expectation (from tracker.md): `undefined` = the input is invalid (error expected). */
function expectation(
  tool: string,
  a: Record<string, unknown>,
  out: Record<string, unknown> | undefined,
  s: AdminState,
) {
  const issue = (k: unknown) => s.issues.find((i) => i.key === k);
  switch (tool) {
    case 'search_issues': {
      if (
        (a.type !== undefined && !TYPES.includes(a.type as string)) ||
        (a.state !== undefined && !STATES.includes(a.state as string))
      )
        return undefined;
      const q = String(a.query ?? '').toLowerCase();
      const items = s.issues
        .filter((i) => !q || i.title.toLowerCase().includes(q) || i.key.toLowerCase() === q)
        .filter(
          (i) =>
            (a.type === undefined || i.type === a.type) && (a.state === undefined || i.state === a.state),
        )
        .filter(
          (i) =>
            (a.label === undefined || i.labels.includes(a.label as string)) &&
            (a.assignee === undefined || i.assignees.includes(a.assignee as string)),
        )
        .map(({ key, title, type, state, priority, labels, assignees, updated_at }) => ({
          key,
          title,
          type,
          state,
          priority,
          labels,
          assignees,
          updated_at,
        }));
      return { items, count: items.length, total: items.length };
    }
    case 'get_issue': {
      const i = issue(a.key);
      return i && { ...i, comment_count: s.comments.filter((c) => c.issue_key === i.key).length };
    }
    case 'list_comments': {
      const i = issue(a.issue_key);
      if (!i) return undefined;
      const items = s.comments
        .filter((c) => c.issue_key === i.key)
        .map(({ id, author, body, created_at }) => ({ id, author, body, created_at }));
      return { issue_key: i.key, items, count: items.length, total: items.length };
    }
    case 'add_comment': {
      if (!issue(a.issue_key) || !String(a.body ?? '').trim()) return undefined;
      const c = s.comments.find((x) => x.id === out?.comment_id);
      return {
        comment_id: c?.id ?? null,
        issue_key: a.issue_key,
        author: c?.author ?? null,
        created_at: c?.created_at ?? null,
      };
    }
    case 'transition_issue': {
      const i = issue(a.key);
      const last = [...s.events]
        .reverse()
        .find((e) => e.kind === 'transition' && e.key === a.key && e.to === a.to);
      if (!i || !last?.ok) return undefined;
      return { key: i.key, state: i.state, previous_state: last.from };
    }
    case 'update_labels': {
      const i = issue(a.key);
      const names = [...((a.add as string[]) ?? []), ...((a.remove as string[]) ?? [])];
      if (!i || names.length === 0 || !names.every((n) => NAME.test(n))) return undefined;
      return { key: i.key, labels: i.labels };
    }
    case 'assign_issue': {
      const i = issue(a.key);
      if (!i || !NAME.test(String(a.assignee))) return undefined;
      return { key: i.key, assignees: i.assignees };
    }
  }
  throw new Error(tool);
}

describe('truth() on 100 seeded random calls (tracker-mcp at the pinned ref, vendor v1)', () => {
  let rec: Recorder;
  beforeAll(async () => {
    rec = await startRecorder({
      repoDir: trackerDomain.repo.dir(),
      serverCommand: trackerDomain.serverCommand,
      clock: TRACKER_FROZEN_CLOCK,
    });
  });
  afterAll(async () => {
    await rec?.close();
  });

  test('truth = admin-state expectation, and the v1 server output matches truth for every tool', async () => {
    const calls = randomCalls(20261021, 100);
    const seenValid = new Set<string>();
    for (const [n, c] of calls.entries()) {
      const r = await rec.call(c.tool, c.args);
      const admin = (await (await fetch(`${rec.vendorUrl}/__admin/state`)).json()) as AdminState;
      const label = `#${n} ${c.tool}(${JSON.stringify(c.args)})`;
      const out = r.result?.isError ? undefined : (r.result?.structuredContent as Record<string, unknown>);
      const inProcess = trackerTruth({ tool: c.tool, args: c.args, output: r.result }, rec.vendor.state);
      const fromAdmin = trackerTruth({ tool: c.tool, args: c.args, output: r.result }, admin);
      expect(fromAdmin, label).toEqual(inProcess);
      const want = expectation(c.tool, c.args, out, admin);
      if (want === undefined) {
        expect(fromAdmin.inputValid, label).toBe(false);
        expect(r.result?.isError, `${label}: invalid input must be an error`).toBe(true);
      } else {
        expect(fromAdmin.inputValid, label).toBe(true);
        expect(fromAdmin.expected, label).toEqual(want);
        seenValid.add(c.tool);
      }
      expect(fromAdmin.mismatches, `${label}: v1 output differs from truth`).toEqual([]);
    }
    expect([...seenValid].sort()).toEqual([...TRACKER_TOOLS].sort());
  });

  test('truth reports the paths where a wrong output differs', () => {
    const state = createVendor({ now: () => new Date(TRACKER_FROZEN_CLOCK) }).state;
    const t = trackerTruth({ tool: 'get_issue', args: { key: 'TRK-113' } }, state);
    const wrong = {
      ...(t.expected as Record<string, unknown>),
      story_points: 0,
      updated_at: '1970-01-01T00:00:00.000Z',
    };
    const r = trackerTruth(
      { tool: 'get_issue', args: { key: 'TRK-113' }, output: { structuredContent: wrong } },
      state,
    );
    expect(r.mismatches).toEqual(['story_points', 'updated_at']);
    expect(
      trackerTruth({ tool: 'get_issue', args: { key: 'TRK-999' }, output: { isError: true } }, state),
    ).toMatchObject({
      inputValid: false,
      mismatches: [],
    });
    expect(
      trackerTruth(
        {
          tool: 'list_comments',
          args: { issue_key: 'TRK-104' },
          output: { structuredContent: { issue_key: 'TRK-104', items: [], count: 0, total: 4 } },
        },
        state,
      ).mismatches,
    ).toEqual(['count', 'items']);
  });
});
