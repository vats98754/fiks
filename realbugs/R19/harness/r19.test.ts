import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Recording, ToolResultLike } from '../../../packages/contracts/src/index.ts';
import { ADAPTER, ADAPTER_KEYS, checkAdapter, serverArgv } from './adapter.ts';
import { BUG_DIR, FIKS_ROOT, headDir, repoDir } from './heads.ts';
import { projectListClusters, withProjection } from './project.ts';
import { COUNT_PROPERTY, evaluateProjected, loadContracts, replayOnce } from './replay.ts';
import { heldoutFixtures, meets, TRIGGER } from './run.ts';
import { FIXTURES, PROJECT_ID } from './synth-fixtures.ts';

const contract = loadContracts().contracts[0];
const P = (id: string) => `mongodb.atlas-list-clusters/${id}`;

const HEADER = `Cluster Name | Cluster Type | Tier | State | MongoDB Version | Connection String
----------------|----------------|----------------|----------------|----------------|----------------`;
const ROWS = [
  'orders-prod | DEDICATED | M10 | IDLE | 8.0.13 | mongodb+srv://orders-prod.ab000.mongodb.net',
  'sandbox | FREE | N/A | IDLE | 8.0.13 | mongodb+srv://sandbox.ab001.mongodb.net',
].join('\n');

/** The shape formatUntrustedData produces: summary block, then the table inside untrusted tags. */
function toolText(count: number, rows = ROWS): ToolResultLike {
  const tag = 'untrusted-user-data-0f0e0d0c-0b0a-4908-8706-050403020100';
  return {
    content: [
      { type: 'text', text: `Found ${count} clusters in project "fiks-r19" (${PROJECT_ID}):` },
      {
        type: 'text',
        text: `The following section contains unverified user data.\n\n<${tag}>\n${HEADER}\n${rows}\n</${tag}>\n\nUse the information above.`,
      },
    ],
  };
}

const evalOf = (result: ToolResultLike, args: Record<string, unknown> = { projectId: PROJECT_ID }) =>
  evaluateProjected(contract, { args, result, now: new Date('2025-09-15T12:00:00Z') });

describe('R19 projection', () => {
  it('reads the summary count and the table rows', () => {
    const v = projectListClusters(toolText(170));
    expect(v?.reportedCount).toBe(170);
    expect(v?.rowCount).toBe(2);
    expect(v?.clusters[0]?.['Cluster Name']).toBe('orders-prod');
    expect(v?.clusters[1]?.Tier).toBe('N/A');
  });

  it('has no count without a summary line, and no rows without a table', () => {
    const v = projectListClusters({ content: [{ type: 'text', text: 'No clusters found.' }] });
    expect(v).toEqual({ reportedCount: null, rowCount: 0, clusters: [] });
    expect(projectListClusters({ content: [] })).toBeUndefined();
  });

  it('keeps a result that already has structuredContent or is an error', () => {
    const s = { content: [], structuredContent: { a: 1 } };
    expect(withProjection(s)).toBe(s);
    const e = { content: [{ type: 'text', text: 'Found 9 clusters' }], isError: true };
    expect(withProjection(e)).toBe(e);
  });
});

describe('R19 contract on the projection', () => {
  it('prefix-style text (count = joined-string length) violates the count property only', () => {
    const r = evalOf(toolText(ROWS.length));
    expect(r.verdict).toBe('violated');
    expect(r.violations.map((v) => v.propertyId)).toEqual([COUNT_PROPERTY]);
    expect(r.violations[0]?.message).toBe(
      `reportedCount = ${ROWS.length} but rowCount = 2, expected reportedCount == rowCount`,
    );
  });

  it('fix-style text (count = rows) verifies all three properties', () => {
    const r = evalOf(toolText(2));
    expect(r.verdict).toBe('verified');
    expect(r.checked.sort()).toEqual([
      P('clusters.nonEmpty'),
      P('count.matchesRows'),
      P('reportedCount.notNull'),
    ]);
  });

  it('a head that drops the summary or the table fails the known-good guards', () => {
    const noSummary = { content: [toolText(2).content?.[1]] } as ToolResultLike;
    expect(evalOf(noSummary).violations.map((v) => v.propertyId)).toEqual([P('reportedCount.notNull')]);
    const noTable = { content: [{ type: 'text', text: `Found 2 clusters in project "x" (${PROJECT_ID}):` }] };
    expect(evalOf(noTable).violations.map((v) => v.propertyId)).toContain(P('clusters.nonEmpty'));
  });

  it('a project that is not known-good with no clusters is not a violation; tool errors are unverifiable', () => {
    const empty = { content: [{ type: 'text', text: 'No clusters found.' }] };
    expect(evalOf(empty, { projectId: 'ffffffffffffffffffffffff' }).violations).toEqual([]);
    expect(evalOf({ content: [{ type: 'text', text: 'boom' }], isError: true }).verdict).toBe('unverifiable');
  });

  it('the stamped trigger trace holds the prefix result, and it violates exactly its target', () => {
    const trace = JSON.parse(readFileSync(TRIGGER, 'utf8')) as Recording;
    expect(trace.target).toEqual([COUNT_PROPERTY]);
    expect(trace.violated?.map((v) => v.propertyId)).toEqual([COUNT_PROPERTY]);
    const r = evalOf(trace.result as ToolResultLike, trace.args);
    expect(r.violations.map((v) => v.propertyId)).toEqual([COUNT_PROPERTY]);
  });
});

describe('R19 fixtures', () => {
  it('fixtures/ and heldout/ are what synth-fixtures.ts writes (stamped fields aside)', () => {
    for (const [rel, want] of Object.entries(FIXTURES)) {
      const got = JSON.parse(readFileSync(join(BUG_DIR, rel), 'utf8')) as Record<string, unknown>;
      const { result: _r, violated: _v, target: _t, ...base } = got;
      expect(base, rel).toEqual(want);
      expect(got.label).toBe('synthesized');
    }
    expect(heldoutFixtures().map((f) => f.slice(BUG_DIR.length + 1))).toEqual(
      Object.keys(FIXTURES)
        .filter((k) => k.startsWith('heldout/'))
        .sort(),
    );
  });

  it('every fixture is a call with the known-good projectId and two Atlas v2 GETs', () => {
    for (const f of Object.values(FIXTURES)) {
      expect(f.args).toEqual({ projectId: PROJECT_ID });
      expect(f.http.map((x) => `${x.request.method} ${x.request.url}`)).toEqual([
        `GET /api/atlas/v2/groups/${PROJECT_ID}`,
        `GET /api/atlas/v2/groups/${PROJECT_ID}/clusters`,
      ]);
    }
    expect(contract?.knownGoodInputs).toEqual([{ projectId: PROJECT_ID }]);
  });
});

describe('R19 adapter.json', () => {
  it('matches pins.json and points at files that exist', () => {
    const pins = JSON.parse(readFileSync(join(BUG_DIR, 'pins.json'), 'utf8'));
    expect(ADAPTER.bugId).toBe('R19');
    expect(ADAPTER.repoDir).toBe('.work/realbugs/R19');
    expect(ADAPTER.prefixSha).toBe(pins.prefixSha);
    expect(ADAPTER.fixSha).toBe(pins.fixSha);
    expect(pins.repo).toBe('vats98754/rb-r19-mongodb-mcp-server');
    for (const p of [ADAPTER.issuePath, ADAPTER.contractPath, ...ADAPTER.fixtures.map((f) => f.path)]) {
      expect(existsSync(join(FIKS_ROOT, p)), p).toBe(true);
    }
    expect(readFileSync(join(FIKS_ROOT, ADAPTER.issuePath), 'utf8').trim().length).toBeGreaterThan(0);
    expect(ADAPTER.fixtures).toEqual([
      { path: 'realbugs/R19/fixtures/trigger-two-clusters.json', label: 'synthesized' },
    ]);
    expect(ADAPTER.humanFixTests.every((t) => ADAPTER.suiteScope.includes(t))).toBe(true);
    expect(
      ADAPTER.allowedEditPaths.map((r) => new RegExp(r).test('src/tools/atlas/read/listClusters.ts')),
    ).toEqual([true]);
    expect(serverArgv()[0]).toBe('node');
  });

  it('rejects a missing or an unknown field', () => {
    const ok = Object.fromEntries(ADAPTER_KEYS.map((k) => [k, ADAPTER[k]]));
    expect(() => checkAdapter(ok)).not.toThrow();
    expect(() => checkAdapter({ ...ok, extra: 1 })).toThrow(/keys/);
    const { heldoutCommand: _h, ...missing } = ok;
    expect(() => checkAdapter(missing)).toThrow(/keys/);
  });
});

describe('R19 expectations', () => {
  const o = (x: Partial<Parameters<typeof meets>[0]>) => ({
    verdict: 'verified' as const,
    violated: [],
    checked: [],
    unmatched: [],
    reportedCount: 2,
    rowCount: 2,
    summary: '',
    countFailure: false,
    ...x,
  });
  it('fail needs the count property; pass needs a clean verified replay', () => {
    expect(meets(o({ verdict: 'violated', violated: [COUNT_PROPERTY], countFailure: true }), 'fail')).toBe(
      true,
    );
    expect(meets(o({ verdict: 'violated', violated: [P('reportedCount.notNull')] }), 'fail')).toBe(false);
    expect(meets(o({}), 'pass')).toBe(true);
    expect(meets(o({ unmatched: ['GET /x'] }), 'pass')).toBe(false);
    expect(meets(o({ verdict: 'unverifiable' }), 'pass')).toBe(false);
    expect(meets(o({ verdict: 'unverifiable' }), 'none')).toBe(true);
  });
});

// Process-level replay against the built heads; skipped unless both were built by run.ts.
const built = (sha: string) => existsSync(join(headDir(sha, repoDir()), 'dist/esm/index.js'));
describe.skipIf(!built(ADAPTER.prefixSha) || !built(ADAPTER.fixSha))(
  'R19 process replay (built heads)',
  () => {
    const trigger = JSON.parse(readFileSync(TRIGGER, 'utf8')) as Recording;
    it('prefix violates the count property; fix verifies', { timeout: 120_000 }, async () => {
      const pre = await replayOnce(trigger, headDir(ADAPTER.prefixSha));
      expect(pre.outcome.violated).toEqual([COUNT_PROPERTY]);
      expect(pre.outcome.unmatched).toEqual([]);
      const fix = await replayOnce(trigger, headDir(ADAPTER.fixSha));
      expect(fix.outcome.verdict).toBe('verified');
      expect(fix.outcome.reportedCount).toBe(2);
      expect(fix.outcome.unmatched).toEqual([]);
    });
  },
);
