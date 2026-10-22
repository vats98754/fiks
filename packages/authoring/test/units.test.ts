// Unit checks: the contract-file schema (mirrors VOCAB's types), ideation through both families with
// the same prompt, the seeded idea order, and the recorded-call selection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contractFileErrors } from '../src/contract-schema.ts';
import { ideate, ideationPrompt, orderIdeas } from '../src/drift.ts';
import { stubDeps } from '../src/stub.ts';
import { ROOT } from './support/cli.ts';

const SHOP = JSON.parse(
  readFileSync(join(ROOT, 'packages/contracts/contracts/shop-mcp.contracts.json'), 'utf8'),
);

describe('contract-file schema', () => {
  test("the hand-written shop contracts pass, with the server's tools", () => {
    expect(
      contractFileErrors(SHOP, {
        server: 'shop-mcp',
        tools: ['search_products', 'get_product', 'create_order', 'get_order'],
        requireTools: ['search_products', 'get_product', 'create_order', 'get_order'],
      }),
    ).toEqual([]);
  });

  test.each([
    ['unknown kind', { kind: 'telepathy', id: 'x', path: 'a' }, /unknown kind/],
    ['missing path', { kind: 'range', id: 'x', min: 1 }, /range\.path is missing/],
    ['range without bounds', { kind: 'range', id: 'x', path: 'a' }, /range needs min or max/],
    ['unknown field', { kind: 'unique', id: 'x', path: 'a', extra: 1 }, /unknown field "extra"/],
    ['disabled set by an author', { kind: 'unique', id: 'x', path: 'a', disabled: true }, /contract-disable/],
    ['bad op', { kind: 'crossField', id: 'x', left: 'a', op: '=~', right: 'b' }, /crossField\.op/],
    [
      'onlyKnownGood without inputs',
      { kind: 'notNull', id: 'x', path: 'a', onlyKnownGood: true },
      /no knownGoodInputs/,
    ],
  ])('%s is rejected', (_name, inv, re) => {
    const file = { server: 's', version: 1, contracts: [{ id: 's.t', tool: 't', invariants: [inv] }] };
    expect(contractFileErrors(file).join('\n')).toMatch(re);
  });

  test('file-level problems', () => {
    expect(contractFileErrors({ server: 's', version: 2, contracts: [] })).toEqual([
      '$: version must be 1',
      '$: contracts must be a non-empty array',
    ]);
    const two = {
      server: 's',
      version: 1,
      contracts: [
        { id: 'a', tool: 't', invariants: [] },
        { id: 'a', tool: 'u', invariants: [] },
      ],
    };
    expect(contractFileErrors(two, { tools: ['t'] })).toEqual([
      'contracts[1]: duplicate contract id a',
      'contracts[1]: tool u is not a tool of the server',
    ]);
    expect(
      contractFileErrors(
        { server: 'x', version: 1, contracts: [{ id: 'a', tool: 't', invariants: [] }] },
        { server: 'y', requireTools: ['t', 'v'] },
      ),
    ).toEqual(['$: server is x, expected y', '$: no contract for tool v']);
  });
});

describe('ideation', () => {
  test('both families get the same prompt; ideas are ordered by a seeded shuffle into idea indexes', async () => {
    const seen: { route: string; prompt: string }[] = [];
    const deps = stubDeps((req) => {
      seen.push({ route: req.route, prompt: req.prompt });
      const fam = req.route === 'ollama' ? 'o' : 'c';
      return {
        structured: {
          ideas: [0, 1, 2].map((i) => ({
            title: `${fam}${i}`,
            description: `idea ${fam}${i}`,
            plausibleString: i === 0,
          })),
        },
      };
    });
    const opus = await ideate({
      domain: 'tracker',
      stratum: 'evasive',
      n: 3,
      family: 'opus',
      model: 'claude-opus-5-5',
      deps,
    });
    const ollama = await ideate({
      domain: 'tracker',
      stratum: 'evasive',
      n: 3,
      family: 'ollama',
      model: 'x',
      ollamaModel: deps.ollamaModel,
      deps,
    });
    expect(opus.ideas.map((i) => i.title)).toEqual(['c0', 'c1', 'c2']);
    expect(ollama.ideas.map((i) => i.title)).toEqual(['o0', 'o1', 'o2']);
    const { system, prompt } = ideationPrompt('tracker', 'evasive', 3);
    expect(seen.map((s) => s.route)).toEqual(['complete', 'ollama']);
    expect(seen[0]?.prompt).toBe(prompt);
    expect(seen[1]?.prompt).toBe(`${system}\n\n${prompt}`);
    expect(prompt).toContain('docs/tracker.md');
    expect(prompt).toContain('Number of ideas requested: 3.');
    expect(prompt).not.toMatch(/fiks|outcome contract|@fiks\//i);

    const a = orderIdeas('tracker', 'evasive', { opus: opus.ideas, ollama: ollama.ideas }, 's1');
    const b = orderIdeas('tracker', 'evasive', { ollama: ollama.ideas, opus: opus.ideas }, 's1');
    expect(a).toEqual(b);
    expect(a.map((i) => i.ideaIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(a.map((i) => i.ideaId)).toEqual([0, 1, 2, 3, 4, 5].map((k) => `tracker-evasive-00${k}`));
    expect(a.filter((i) => i.family === 'ollama')).toHaveLength(3);
    expect(a.filter((i) => i.plausibleString)).toHaveLength(2);
    expect(
      orderIdeas('tracker', 'evasive', { opus: opus.ideas, ollama: ollama.ideas }, 's2').map((i) => i.title),
    ).not.toEqual(a.map((i) => i.title));
  });
});
