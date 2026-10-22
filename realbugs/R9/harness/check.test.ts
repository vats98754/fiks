import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HttpExchange, ToolResultLike } from '../../../packages/contracts/src/index.ts';
import { loadCases } from '../heldout/run.ts';
import { fixtureLabel, R9_ADAPTER, R9_EXTRA } from './adapter.ts';
import {
  type CaseIO,
  evaluateCase,
  gradeHeldout,
  idValues,
  loadContract,
  textBlocks,
  upstreamItemIds,
} from './check.ts';
import { NAMED_PROPERTY } from './run.ts';
import { findRepoPackage, loadCase, MATCHERS } from './server.ts';

const contract = loadContract();
const trigger = loadCase(new URL('../fixtures/trigger.json', import.meta.url).pathname);

const text = (t: string) => ({ type: 'text', text: t });
const io = (
  result: ToolResultLike,
  upstream: HttpExchange[] = trigger.http,
  tool = 'zones_list',
): CaseIO => ({
  tool,
  args: {},
  result,
  upstream,
});
const zonesJson = JSON.stringify(JSON.parse(trigger.http[0]?.response.body ?? '{}').result);

describe('blind contract (textJson, carriesUpstream)', () => {
  it('flags the issue symptom: a text block that is the literal [object Object]', () => {
    const r = evaluateCase(contract, io({ content: [text('[object Object]')] }));
    expect(r.verdict).toBe('violated');
    expect(r.violations.map((v) => v.propertyId)).toContain(NAMED_PROPERTY);
    expect(r.violations.find((v) => v.propertyId === NAMED_PROPERTY)?.message).toContain('[object Object]');
  });

  it('flags prose with no JSON block, and JSON that embeds a coerced object', () => {
    expect(evaluateCase(contract, io({ content: [text('Here are your zones')] })).verdict).toBe('violated');
    const embedded = evaluateCase(contract, io({ content: [text('{"zones":["[object Object]"]}')] }));
    expect(embedded.violations.map((v) => v.propertyId)).toContain(NAMED_PROPERTY);
  });

  it('verifies a JSON text block that carries every upstream zone id', () => {
    const r = evaluateCase(contract, io({ content: [text(zonesJson)] }));
    expect(r.verdict).toBe('verified');
    expect(r.checked.sort()).toEqual(['cloudflare.zones_list/carriesUpstream', NAMED_PROPERTY]);
  });

  it('carriesUpstream flags JSON that drops upstream zones', () => {
    const r = evaluateCase(contract, io({ content: [text('[]')] }));
    expect(r.violations.map((v) => v.propertyId)).toEqual(['cloudflare.zones_list/carriesUpstream']);
  });

  it('as written blind: a result with no text block passes textJson (the documented R9 false negative)', () => {
    // What a spec client (MCP SDK CallToolResultSchema) makes of the 0.2.0 wire response
    // {"toolResult": {...}}: content defaults to [], the payload sits under a non-standard key.
    const r = evaluateCase(
      contract,
      io({ content: [], toolResult: { content: [text(zonesJson)] } } as never, []),
    );
    expect(r.verdict).toBe('verified');
    expect(r.checked).toEqual([NAMED_PROPERTY]);
  });

  it('isError results are unverifiable; tools outside the contract are unverifiable', () => {
    expect(evaluateCase(contract, io({ isError: true, content: [text('Error: x')] })).verdict).toBe(
      'unverifiable',
    );
    expect(evaluateCase(contract, io({ content: [] }, [], 'domain_list')).contractId).toBeNull();
  });

  it('merges the standard @fiks/contracts result (declared outputSchema)', () => {
    const standard = {
      verdict: 'violated' as const,
      contractId: 'cloudflare.zones_list',
      checked: ['cloudflare.zones_list/outputSchema'],
      violations: [
        {
          propertyId: 'cloudflare.zones_list/outputSchema',
          kind: 'outputSchema',
          path: '$',
          expected: 'structuredContent',
          actual: null,
          message: 'no structured result',
        },
      ],
    };
    const r = evaluateCase(contract, io({ content: [text(zonesJson)] }), standard);
    expect(r.verdict).toBe('violated');
    expect(r.checked).toContain('cloudflare.zones_list/outputSchema');
  });
});

describe('held-out oracle', () => {
  const cases = loadCases();
  const h = (id: string) => {
    const c = cases.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };

  it('has four manifestations and a control, all synthesized, ids unique', () => {
    expect(cases.filter((c) => c.role === 'manifestation')).toHaveLength(4);
    expect(cases.filter((c) => c.role === 'control')).toHaveLength(1);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.every((c) => c.label === 'synthesized')).toBe(true);
  });

  it('data: passes a bare array, the full envelope, and JSON plus prose; fails mock ids and no payload', () => {
    const c = h('H1-zones-other-account');
    const body = c.http[0]?.response.body ?? '';
    const zones = JSON.parse(body).result;
    const ok = (result: ToolResultLike) => gradeHeldout(c.expect, io(result, c.http)).ok;
    expect(ok({ content: [text(JSON.stringify(zones))] })).toBe(true);
    expect(ok({ content: [text(body)] })).toBe(true);
    expect(ok({ content: [text('3 zones:'), text(JSON.stringify(zones))] })).toBe(true);
    expect(ok({ content: [text(JSON.stringify([...zones, { id: 'zone-abc123' }]))] })).toBe(false);
    expect(ok({ content: [] })).toBe(false);
    expect(ok({ content: [text('[object Object]')] })).toBe(false);
    expect(gradeHeldout(c.expect, io({ content: [text(JSON.stringify(zones))] }, [])).ok).toBe(false);
  });

  it('data with mustContain (items without id) and error expectations', () => {
    const q = h('H3-queue_list');
    expect(gradeHeldout(q.expect, io({ content: [text('{}')] }, q.http)).reasons.join()).toContain(
      'r9-orders',
    );
    const e = h('H4-domain_list-403');
    expect(gradeHeldout(e.expect, io({ isError: true, content: [text('Error')] }, e.http)).ok).toBe(true);
    expect(gradeHeldout(e.expect, io({ content: [] }, e.http)).ok).toBe(false);
  });

  it('helpers: text blocks, upstream ids, id values', () => {
    expect(textBlocks({ content: [text('a'), { type: 'image', data: '' }, text('b')] })).toEqual(['a', 'b']);
    expect(upstreamItemIds(trigger.http)).toEqual([
      '9a7806061c88ada191ed06f989cc3dac',
      '5c1e2d3f4a5b6c7d8e9f0a1b2c3d4e5f',
    ]);
    expect([...idValues({ a: [{ id: 'x', b: { id: 'y' } }] })]).toEqual(['x', 'y']);
  });
});

describe('adapter, pins and fixtures', () => {
  const pins = JSON.parse(readFileSync(new URL('../pins.json', import.meta.url), 'utf8'));

  it('adapter matches pins and the RealbugAdapter type', () => {
    expect(R9_ADAPTER.bugId).toBe('R9');
    expect(R9_ADAPTER.repoDir).toBe('.work/realbugs/R9');
    expect(R9_ADAPTER.prefixSha).toBe(pins.prefixSha);
    expect(R9_ADAPTER.fixSha).toBe(pins.fixSha);
    expect(pins.repo).toBe('vats98754/rb-r9-mcp-server-cloudflare');
    expect(R9_EXTRA.namedProperty).toBe(NAMED_PROPERTY);
    expect(R9_ADAPTER.humanFixTests).toEqual([]);
    expect(() => fixtureLabel('made-up')).toThrow();
    for (const f of R9_ADAPTER.fixtures) {
      expect(() => readFileSync(new URL(`../../../${f.path}`, import.meta.url))).not.toThrow();
    }
  });

  it('allowedEditPaths are valid regexes that admit the stdio package and refuse the fiks tree', () => {
    const res = R9_ADAPTER.allowedEditPaths.map((s) => new RegExp(s));
    const allowed = (p: string) => res.some((r) => r.test(p));
    expect(allowed('packages/mcp-server-cloudflare/src/cli.js')).toBe(true);
    expect(allowed('.changeset/quiet-mice.md')).toBe(true);
    expect(allowed('.github/workflows/main.yml')).toBe(false);
    expect(allowed('apps/workers-bindings/wrangler.jsonc')).toBe(false);
  });

  it('the npx lock pins the published 0.2.0 by the integrity in pins.json', () => {
    const lock = JSON.parse(
      readFileSync(new URL('./npx-0.2.0/package-lock.json', import.meta.url), 'utf8'),
    ) as { packages: Record<string, { version?: string; integrity?: string }> };
    const pkg = lock.packages['node_modules/@cloudflare/mcp-server-cloudflare'];
    expect(pkg?.version).toBe('0.2.0');
    expect(pkg?.integrity).toBe(pins.artifact.integrity);
  });

  it('request matching ignores the query of list endpoints', () => {
    expect(MATCHERS.normalisers[0]?.pattern).toBe('\\?.*$');
  });

  it('findRepoPackage: a private root package with the name does not count; a publishable one does', () => {
    const tree = mkdtempSync(join(tmpdir(), 'fiks-r9-pkg-'));
    try {
      const name = '@cloudflare/mcp-server-cloudflare';
      writeFileSync(join(tree, 'package.json'), JSON.stringify({ name, private: true }));
      expect(findRepoPackage(tree)).toBeNull();
      mkdirSync(join(tree, 'packages', 'stdio'), { recursive: true });
      writeFileSync(
        join(tree, 'packages', 'stdio', 'package.json'),
        JSON.stringify({ name, bin: { 'mcp-server-cloudflare': 'src/cli.js' } }),
      );
      expect(findRepoPackage(tree)).toEqual({ dir: 'packages/stdio', bin: 'packages/stdio/src/cli.js' });
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});
