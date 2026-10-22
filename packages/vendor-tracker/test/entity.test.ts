// entityClass() and originEntity() for every tool on 100 seeded calls (outputs from the real
// tracker-mcp server on vendor v1), plus the attribution rules of PLAN 3.1.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  TRACKER_FROZEN_CLOCK,
  TRACKER_TOOLS,
  trackerDomain,
  trackerEntityClass,
  trackerOriginEntity,
} from '../src/index.ts';
import { type Recorder, startRecorder } from '../src/record.ts';
import { randomCalls } from './support/calls.ts';

const EXT = new URL('./fixtures/extended-sample.json', import.meta.url).pathname;

describe('entityClass / originEntity on 100 seeded calls', () => {
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
  beforeEach(() => rec.vendor.reset());

  test('defined (non-empty, one value per concrete path) for every tool', async () => {
    const tools = new Set<string>();
    for (const c of randomCalls(7, 100)) {
      const r = await rec.call(c.tool, c.args);
      const call = { tool: c.tool, args: c.args, output: r.result };
      const cls = trackerDomain.entityClass(call);
      const org = trackerDomain.originEntity(call);
      const label = `${c.tool}(${JSON.stringify(c.args)})`;
      expect(Object.keys(cls).length, label).toBeGreaterThan(0);
      expect(Object.keys(org).sort(), label).toEqual(Object.keys(cls).sort());
      for (const [p, v] of Object.entries(cls))
        expect(typeof v === 'string' && v.length > 0, `${label} class ${p}`).toBe(true);
      for (const [p, v] of Object.entries(org))
        expect(typeof v === 'string' && v.length > 0, `${label} origin ${p}`).toBe(true);
      // Without an output the paths are the tool's top-level fields, still all defined.
      const bare = trackerDomain.originEntity({ tool: c.tool, args: c.args });
      expect(
        Object.values(bare).every((v) => typeof v === 'string' && v.length > 0),
        label,
      ).toBe(true);
      tools.add(c.tool);
    }
    expect([...tools].sort()).toEqual([...TRACKER_TOOLS].sort());
  });

  test("a comment call's origin is its parent issue, and its class is the parent's class", async () => {
    const add = await rec.call('add_comment', { issue_key: 'TRK-104', body: 'Origin check.' });
    const list = await rec.call('list_comments', { issue_key: 'TRK-104' });
    for (const r of [add, list]) {
      const call = { tool: r.tool, args: r.args, output: r.result };
      const org = trackerDomain.originEntity(call);
      expect(new Set(Object.values(org))).toEqual(new Set(['TRK-104']));
      expect(org['items[0].id'] ?? org.comment_id).toBe('TRK-104');
      expect(new Set(Object.values(trackerDomain.entityClass(call)))).toEqual(new Set(['bug:resolved']));
    }
  });

  test('child tools (transition, labels, assignees) attribute to the parent issue and keep its catalogued class', async () => {
    const t = await rec.call('transition_issue', { key: 'TRK-105', to: 'in_progress' });
    const call = { tool: t.tool, args: t.args, output: t.result };
    expect(new Set(Object.values(trackerDomain.originEntity(call)))).toEqual(new Set(['TRK-105']));
    // TRK-105 is catalogued as an open feature; the class does not follow the move.
    expect(new Set(Object.values(trackerDomain.entityClass(call)))).toEqual(new Set(['feature:open']));
  });

  test('search: element paths -> the element issue; collection paths -> the S-grid query id', async () => {
    const r = await rec.call('search_issues', { type: 'bug', state: 'open' });
    const call = { tool: r.tool, args: r.args, output: r.result };
    const org = trackerOriginEntity(call);
    const cls = trackerEntityClass(call, () => undefined);
    const q = 'query:{"state":"open","type":"bug"}';
    for (const p of ['', 'items', 'count', 'total']) expect(org[p], p).toBe(q);
    expect(org['items[0]']).toBe('TRK-101');
    expect(org['items[1].title']).toBe('TRK-108');
    expect(org['items[3].labels[0]']).toBe('TRK-117');
    const full = trackerDomain.entityClass(call);
    for (const p of ['', 'items', 'count', 'total']) expect(full[p], p).toBe('bug:open');
    expect(full['items[2].key']).toBe('bug:open');
    // Unknown to the index: the class falls back to the type and state the output reports.
    expect(cls['items[0].key']).toBe('bug:open');
    const all = trackerDomain.entityClass({ tool: 'search_issues', args: { label: 'security' } });
    expect(all['']).toBe('all');
    expect(trackerDomain.entityClass({ tool: 'search_issues', args: { state: 'closed' } }).total).toBe(
      '*:closed',
    );
  });

  test('extended issues get their class from the extended catalog', () => {
    const prev = process.env.TRACKER_EXTENDED_CATALOG;
    process.env.TRACKER_EXTENDED_CATALOG = EXT;
    try {
      expect(trackerDomain.entityClass({ tool: 'get_issue', args: { key: 'TX-B1' } }).key).toBe('bug:closed');
      expect(trackerDomain.entityClass({ tool: 'list_comments', args: { issue_key: 'TX-A2' } }).items).toBe(
        'feature:in_progress',
      );
      expect(trackerDomain.entityClass({ tool: 'get_issue', args: { key: 'TX-NOPE' } }).key).toBe('unknown');
    } finally {
      if (prev === undefined) delete process.env.TRACKER_EXTENDED_CATALOG;
      else process.env.TRACKER_EXTENDED_CATALOG = prev;
    }
  });
});
