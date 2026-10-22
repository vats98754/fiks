import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureLabel, R10_ADAPTER, R10_EXTRA } from './adapter.ts';
import { type CaseIO, evaluateCase, heldoutVerdict, loadContract, mentioned, readBack } from './check.ts';
import { BUG_DIR, FIKS_ROOT, repoDir } from './server.ts';

const contract = loadContract();
const PROP = 'memory.create_entities/readAfterWrite';
const alice = (obs: string[]) => ({ name: 'Alice', entityType: 'person', observations: obs });
const text = (v: unknown) => ({ type: 'text', text: JSON.stringify(v, null, 2) });
const probeOf = (entities: unknown[]): CaseIO['probe'] => ({
  tool: 'open_nodes',
  args: {},
  result: { structuredContent: { entities, relations: [] } },
});

describe('blind contract (readAfterWriteRequested)', () => {
  it('fires on the issue symptom: dropped, not named, not read back', () => {
    const r = evaluateCase(contract, {
      args: { entities: [alice(['Allergic to penicillin'])] },
      result: { content: [text([])], structuredContent: { entities: [] } },
      probe: probeOf([alice(['Works at Acme'])]),
    });
    expect(r.verdict).toBe('violated');
    expect(r.violations.map((v) => v.propertyId)).toEqual([PROP]);
    expect(r.violations[0]?.message).toContain('dropped Alice silently');
  });

  it('verifies when the response names the skipped entity outside `entities`', () => {
    const r = evaluateCase(contract, {
      args: { entities: [alice(['Allergic to penicillin'])] },
      result: { content: [text([])], structuredContent: { entities: [], skipped: ['Alice'] } },
      probe: probeOf([alice(['Works at Acme'])]),
    });
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual([PROP]);
  });

  it('verifies when the observations were merged (the other fix direction)', () => {
    const r = evaluateCase(contract, {
      args: { entities: [alice(['Allergic to penicillin'])] },
      result: { content: [text([])], structuredContent: { entities: [] } },
      probe: probeOf([alice(['Works at Acme', 'Allergic to penicillin'])]),
    });
    expect(r.verdict).toBe('verified');
  });

  it('fires when an entity is claimed as created but not read back', () => {
    const r = evaluateCase(contract, {
      args: { entities: [alice(['x'])] },
      result: { content: [text([alice(['x'])])], structuredContent: { entities: [alice(['x'])] } },
      probe: probeOf([]),
    });
    expect(r.verdict).toBe('violated');
    expect(r.violations[0]?.message).toContain('listed Alice as created');
  });

  it('is unverifiable on an explicit tool error, and a failed probe is not a read-back', () => {
    expect(
      evaluateCase(contract, { args: { entities: [alice(['x'])] }, result: { isError: true, content: [] } })
        .verdict,
    ).toBe('unverifiable');
    expect(readBack(alice(['x']), { tool: 'open_nodes', args: {}, result: { isError: true } })).toBe(false);
  });

  it('a text-block mention counts as the blind signal (documented false-negative source)', () => {
    expect(mentioned('Alice', { content: [{ type: 'text', text: 'Skipped 1 entity: Alice.' }] })).toBe(true);
    expect(mentioned('Alice', { structuredContent: { entities: [alice([])] } })).toBe(false);
  });
});

describe('held-out oracle', () => {
  it('a text block that only echoes the created list is no signal', () => {
    const v = heldoutVerdict(
      {
        args: { entities: [alice(['new fact'])] },
        result: { content: [text([])], structuredContent: { entities: [] } },
        probe: probeOf([alice(['old'])]),
      },
      { control: false },
    );
    expect(v.ok).toBe(false);
    expect(v.reasons[0]).toContain('item 0 (Alice)');
  });

  it('accepts a skip report for a same-batch repeat and requires claimed writes to read back', () => {
    const ivy = (o: string) => ({ name: 'Ivy', entityType: 'person', observations: [o] });
    const ok = heldoutVerdict(
      {
        args: { entities: [ivy('a'), ivy('b')] },
        result: {
          content: [text([ivy('a')])],
          structuredContent: { entities: [ivy('a')], skipped: ['Ivy'] },
        },
        probe: probeOf([ivy('a')]),
      },
      { control: false },
    );
    expect(ok.ok).toBe(true);
    const lost = heldoutVerdict(
      {
        args: { entities: [ivy('a')] },
        result: {
          content: [text([ivy('a')])],
          structuredContent: { entities: [ivy('a')], skipped: ['Ivy'] },
        },
        probe: probeOf([]),
      },
      { control: false },
    );
    expect(lost.claimedNotReadBack).toEqual(['Ivy']);
    expect(lost.ok).toBe(false);
  });

  it('an error is acceptable on a manifestation but not on a control', () => {
    const io = { args: { entities: [alice(['x'])] }, result: { isError: true } };
    expect(heldoutVerdict(io, { control: false }).ok).toBe(true);
    expect(heldoutVerdict(io, { control: true }).ok).toBe(false);
  });
});

describe('adapter.json', () => {
  const pins = JSON.parse(readFileSync(join(BUG_DIR, 'pins.json'), 'utf8'));

  it('matches pins.json and points at the clone under .work', () => {
    expect(R10_ADAPTER.bugId).toBe('R10');
    expect(R10_ADAPTER.prefixSha).toBe(pins.prefixSha);
    expect(R10_ADAPTER.fixSha).toBe(pins.fixSha);
    expect(pins.repo).toBe('vats98754/rb-r10-servers');
    expect(R10_ADAPTER.repoDir).toBe('.work/realbugs/R10');
    expect(repoDir({})).toBe(join(FIKS_ROOT, '.work/realbugs/R10'));
    expect(existsSync(join(BUG_DIR, 'repo'))).toBe(false);
  });

  it('names files that exist, with valid labels, and a non-empty issue', () => {
    for (const p of [R10_ADAPTER.issuePath, R10_ADAPTER.contractPath, R10_EXTRA.triggerFixture]) {
      expect(existsSync(join(FIKS_ROOT, p)), p).toBe(true);
    }
    for (const f of R10_ADAPTER.fixtures) expect(existsSync(join(FIKS_ROOT, f.path)), f.path).toBe(true);
    expect(new Set(R10_ADAPTER.fixtures.map((f) => f.label))).toEqual(new Set(['recorded', 'synthesized']));
    expect(() => fixtureLabel('captured')).toThrow();
    expect(readFileSync(join(FIKS_ROOT, R10_ADAPTER.issuePath), 'utf8').trim().length).toBeGreaterThan(100);
    expect(R10_EXTRA.namedProperty).toBe(PROP);
    expect(contract.realbug.properties[0]?.id).toBe(PROP);
  });

  it('allowedEditPaths admit the server source and its tests, not config or manifests', () => {
    const res = R10_ADAPTER.allowedEditPaths.map((s) => new RegExp(s));
    const allowed = (p: string) => res.some((r) => r.test(p));
    for (const p of [
      'src/memory/index.ts',
      'src/memory/graph.ts',
      'src/memory/__tests__/tools.test.ts',
      'src/memory/__tests__/create-reporting.test.ts',
      'src/memory/README.md',
      '.changeset/memory-x.md',
    ]) {
      expect(allowed(p), p).toBe(true);
    }
    for (const p of [
      'src/memory/vitest.config.ts',
      'src/memory/package.json',
      'package-lock.json',
      'src/filesystem/index.ts',
      'src/memory/dist/index.js',
      '.github/workflows/ci.yml',
    ]) {
      expect(allowed(p), p).toBe(false);
    }
    for (const t of R10_ADAPTER.humanFixTests) expect(allowed(t), t).toBe(true);
  });
});
