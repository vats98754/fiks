import { evaluate, findContract, SHOP_CONTRACTS } from '@fiks/contracts';
import type { CallRecord } from '@fiks/interfaces';
import { describe, expect, it } from 'vitest';
import {
  acceptDelta,
  type ContractDelta,
  type GateContext,
  type GateInput,
  toGateCase,
} from '../src/index.ts';
import {
  cleanCorpus,
  D1,
  edit,
  load,
  premiumProduct,
  premiumSearch,
  productVariants,
  searchVariants,
  shopOutputSchemas,
  storedTraces,
} from './helpers.ts';

const SEARCH_RANGE = 'shop.search_products/items.price.range';
const PRODUCT_RANGE = 'shop.get_product/price.range';
const PRODUCT_NOT_NULL = 'shop.get_product/price.notNull';
const PRODUCT_SCHEMA = 'shop.get_product/outputSchema';

function ctx(
  trigger: GateInput,
  mutationVariants: GateInput[],
  over: Partial<GateContext> = {},
): GateContext {
  return {
    contracts: SHOP_CONTRACTS,
    trigger,
    storedViolations: storedTraces(),
    cleanCorpus: cleanCorpus(),
    mutationVariants,
    declaredOutputSchemas: shopOutputSchemas(),
    ...over,
  };
}

const widenSearch = (max: number, min = 20): ContractDelta => ({
  rationale: 'Vendor changelog: premium laptops above $2,000 are now sold.',
  ops: [
    {
      op: 'replaceInvariant',
      contractId: 'shop.search_products',
      invariant: { id: 'items.price.range', kind: 'range', path: 'items[*].price', min, max, unit: 'USD' },
    },
  ],
});

const widenProduct = (max: number, min = 20): ContractDelta => ({
  rationale: 'Vendor changelog: p-1004 is now a premium model.',
  ops: [
    {
      op: 'replaceInvariant',
      contractId: 'shop.get_product',
      invariant: { id: 'price.range', kind: 'range', path: 'price', min, max, unit: 'USD' },
    },
  ],
});

/** Evaluates as the live proxy does: with the server's declared outputSchema for the tool. */
const violatedIds = (rec: GateInput, file = SHOP_CONTRACTS) => {
  const c = toGateCase(rec);
  if (!c.result) throw new Error('no result');
  return evaluate(findContract(file, c.tool), {
    args: c.args,
    result: c.result,
    now: new Date(c.now),
    declaredOutputSchema: shopOutputSchemas()[c.tool] ?? undefined,
    upstream: c.upstream,
    probe: c.probe,
  }).violations.map((v) => v.propertyId);
};

describe('fixtures', () => {
  it('stored D1-D5 traces violate their targets and the v1 corpus is clean under the shop contracts', () => {
    for (const t of storedTraces()) expect(violatedIds(t)).toEqual(expect.arrayContaining(t.target ?? []));
    const corpus = cleanCorpus().map((r) => ({ id: r.id, violated: violatedIds(r) }));
    expect(corpus).toHaveLength(10);
    expect(corpus.filter((c) => c.violated.length)).toEqual([]);
    expect(violatedIds(premiumSearch())).toEqual([SEARCH_RANGE]);
    expect(violatedIds(premiumProduct())).toEqual([PRODUCT_RANGE]);
  });
});

describe('acceptDelta: acceptance items (PLAN P12)', () => {
  it('rejects a delta that silences the stored D1 violation trace', () => {
    // An agent that reads D1's cents as a legitimate range change: widen to 200,000.
    const r = acceptDelta(widenSearch(200_000), ctx(premiumSearch(), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ check: 'stored', caseId: D1().id, property: SEARCH_RANGE }),
    );
    // The trigger itself verified: the stored-trace check alone is what rejects it.
    expect(r.summary.trigger).toEqual({ before: 'violated', after: 'verified' });
    expect(r.findings.every((f) => f.check === 'stored')).toBe(true);
    expect(r.reasons.some((x) => x.startsWith('[stored]') && x.includes(D1().id))).toBe(true);
  });

  it('rejects the same delta when the D1 trace itself is the trigger', () => {
    const r = acceptDelta(widenSearch(200_000), ctx(D1(), searchVariants(D1())));
    expect(r.accepted).toBe(false);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ check: 'stored', caseId: D1().id, property: SEARCH_RANGE }),
    );
  });

  it('accepts widening price.range to admit a benign $2,500 product while the D1 trace still violates', () => {
    const r = acceptDelta(widenSearch(3000), ctx(premiumSearch(), searchVariants()));
    expect(r.reasons).toEqual([]);
    expect(r.accepted).toBe(true);
    expect(r.amended).toEqual([SEARCH_RANGE]);
    expect(r.summary.trigger).toEqual({ before: 'violated', after: 'verified' });
    expect(r.summary.stored).toEqual({ total: 5, used: 5, stillViolate: 5 });
    // product-unknown is an isError result (unverifiable); the other nine verify.
    expect(r.summary.corpus).toEqual({ total: 10, verified: 9, regressions: 0 });
    // D1 still violates the proposed contract, on the amended property.
    expect(r.proposed).toBeDefined();
    if (!r.proposed) return;
    expect(violatedIds(D1(), r.proposed)).toContain(SEARCH_RANGE);
    expect(violatedIds(premiumSearch(), r.proposed)).toEqual([]);
  });

  it('rejects a delta that stops rejecting an M5 mutant on a different property', () => {
    const variants = productVariants();
    const m5 = variants.find((v) => v.mutant === 'M5');
    expect(m5 && violatedIds(m5)).toEqual([PRODUCT_NOT_NULL]);
    // Widen price.range (the trigger's property) and drop p-1004 from the known-good inputs, which
    // turns off price.notNull (onlyKnownGood) for it: the M5 null-price mutant gets through.
    const delta: ContractDelta = {
      rationale: 'p-1004 is now premium and no longer a reference product.',
      ops: [
        ...widenProduct(3000).ops,
        { op: 'removeKnownGoodInput', contractId: 'shop.get_product', input: { id: 'p-1004' } },
      ],
    };
    const r = acceptDelta(delta, ctx(premiumProduct(), variants));
    expect(r.accepted).toBe(false);
    expect(r.findings).toEqual([
      expect.objectContaining({ check: 'mutation', caseId: m5?.id, property: PRODUCT_NOT_NULL }),
    ]);
    expect(r.reasons[0]).toContain('[M5]');

    // Control: the same widening without the known-good edit is accepted.
    const ok = acceptDelta(widenProduct(3000), ctx(premiumProduct(), productVariants()));
    expect(ok.reasons).toEqual([]);
    expect(ok.accepted).toBe(true);
  });
});

describe('acceptDelta: other checks', () => {
  it('rejects amending a property the trigger does not violate (scope)', () => {
    const delta: ContractDelta = {
      rationale: 'x',
      ops: [
        {
          op: 'replaceInvariant',
          contractId: 'shop.search_products',
          invariant: { id: 'items.id.unique', kind: 'unique', path: 'items[*].name' },
        },
        ...widenSearch(3000).ops,
      ],
    };
    const r = acceptDelta(delta, ctx(premiumSearch(), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ check: 'scope', property: 'shop.search_products/items.id.unique' }),
    );
  });

  it("rejects edits to a contract other than the trigger's", () => {
    const delta: ContractDelta = {
      rationale: 'x',
      ops: [
        ...widenSearch(3000).ops,
        { op: 'addKnownGoodInput', contractId: 'shop.get_product', input: { id: 'p-1009' } },
      ],
    };
    const r = acceptDelta(delta, ctx(premiumSearch(), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings.map((f) => f.check)).toEqual(['scope']);
  });

  it('rejects a delta when the trigger does not violate the current contract', () => {
    const r = acceptDelta(widenSearch(3000), ctx(load('shop-v1/search-laptop.json'), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings.map((f) => f.check)).toContain('trigger');
  });

  it('rejects a delta that leaves the trigger violated', () => {
    const r = acceptDelta(widenSearch(2400), ctx(premiumSearch(), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toEqual([expect.objectContaining({ check: 'trigger' })]);
    expect(r.summary.trigger.after).toBe('violated');
  });

  it('rejects a delta that makes a clean v1 case violate (corpus)', () => {
    // min 100 admits the trigger but rejects the $60-$99 cables in the v1 corpus.
    const r = acceptDelta(widenSearch(3000, 100), ctx(premiumSearch(), searchVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toContainEqual(
      expect.objectContaining({ check: 'corpus', caseId: 'v1-search-cable', property: SEARCH_RANGE }),
    );
    expect(r.summary.corpus.regressions).toBe(1);
  });

  it('rejects an amendment that neutralises the property (no variant rejected on it any more)', () => {
    const r = acceptDelta(widenProduct(1e9, 0), ctx(premiumProduct(), productVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toEqual([expect.objectContaining({ check: 'mutation', property: PRODUCT_RANGE })]);
  });

  it('fails closed on missing inputs', () => {
    const r = acceptDelta(
      widenSearch(3000),
      ctx(premiumSearch(), [], { cleanCorpus: [], storedViolations: [] }),
    );
    expect(r.accepted).toBe(false);
    expect(r.findings.filter((f) => f.check === 'input')).toHaveLength(3);
    const noResult = { ...premiumSearch(), result: undefined };
    const r2 = acceptDelta(widenSearch(3000), ctx(noResult, searchVariants()));
    expect(r2.accepted).toBe(false);
    expect(r2.findings).toContainEqual(expect.objectContaining({ check: 'input', caseId: noResult.id }));
  });

  it('fails closed when no stored trace violates its target under the current contract', () => {
    // A clean v1 recording as the only "stored violation": nothing to keep violating.
    const r = acceptDelta(
      widenProduct(3000),
      ctx(premiumProduct(), productVariants(), { storedViolations: [load('shop-v1/search-laptop.json')] }),
    );
    expect(r.accepted).toBe(false);
    expect(r.summary.stored).toEqual({ total: 1, used: 0, stillViolate: 0 });
    expect(r.findings).toEqual([
      expect.objectContaining({ check: 'input', message: expect.stringContaining('stored true-violation') }),
    ]);
  });

  it('fails closed when no clean corpus case verifies under the current contract', () => {
    // product-unknown is an isError result: evaluable, but unverifiable.
    const r = acceptDelta(
      widenProduct(3000),
      ctx(premiumProduct(), productVariants(), { cleanCorpus: [load('shop-v1/product-unknown.json')] }),
    );
    expect(r.accepted).toBe(false);
    expect(r.summary.corpus).toEqual({ total: 1, verified: 0, regressions: 0 });
    expect(r.findings).toEqual([
      expect.objectContaining({ check: 'input', message: expect.stringContaining('clean v1 corpus') }),
    ]);
  });

  it('fails closed when no mutation variant was rejected before the delta', () => {
    // M2 ($24.99) is inside the current $20-$2,000 range: the current contract rejects nothing.
    const m2 = productVariants().filter((v) => v.mutant === 'M2');
    expect(m2.map((v) => violatedIds(v))).toEqual([[]]);
    const r = acceptDelta(widenProduct(3000), ctx(premiumProduct(), m2));
    expect(r.accepted).toBe(false);
    expect(r.summary.mutation).toEqual({ total: 1, rejectedBefore: 0, rejectedAfter: 0 });
    expect(r.findings).toEqual([
      expect.objectContaining({ check: 'input', message: expect.stringContaining('mutation variants') }),
    ]);
  });

  it('rejects malformed or no-op deltas before evaluating anything', () => {
    const c = ctx(premiumSearch(), searchVariants());
    const bad = [
      { rationale: 'x', ops: [{ op: 'removeInvariant', contractId: 'shop.search_products', id: 'x' }] },
      { rationale: 'x', ops: [] },
      { ops: widenSearch(3000).ops },
      { rationale: 'x', ops: [{ ...widenSearch(3000).ops[0], contractId: 'shop.nope' }] },
      widenSearch(2000), // unchanged
      {
        rationale: 'x',
        ops: [
          {
            op: 'replaceInvariant',
            contractId: 'shop.search_products',
            invariant: { id: 'items.price.range', kind: 'range', path: 'items[*].price' },
          },
        ],
      },
      {
        rationale: 'x',
        ops: [
          {
            op: 'addInvariant',
            contractId: 'shop.search_products',
            invariant: { id: 'items.price.range', kind: 'range', path: 'items[*].price', max: 1 },
          },
        ],
      },
    ];
    for (const d of bad) {
      const r = acceptDelta(d, c);
      expect(r.accepted, JSON.stringify(d)).toBe(false);
      expect(r.findings.every((f) => f.check === 'delta')).toBe(true);
      expect(r.summary.trigger.before).toBeNull();
    }
  });

  it('accepts CallRecord inputs the same way as product-format recordings', () => {
    const asCallRecord = (rec: GateInput): CallRecord => {
      const c = toGateCase(rec);
      return {
        callId: c.id,
        domain: 'shop',
        stratum: 'dev',
        catalog: 'original',
        drift: null,
        mutant: c.mutant ?? null,
        tool: c.tool,
        args: c.args,
        upstream: c.upstream.map(({ request, response }) => ({ request, response })),
        output: c.result ?? {},
        events: [],
        entityClass: {},
        originUnit: {},
        capturedAt: c.now,
        controlOf: null,
      };
    };
    // create_order needs a probe, which CallRecords do not carry: keep that one a recording.
    const corpus = cleanCorpus().map((r) => (r.tool === 'create_order' ? r : asCallRecord(r)));
    const variants = searchVariants().map(asCallRecord);
    const a = acceptDelta(
      widenSearch(3000),
      ctx(asCallRecord(premiumSearch()), variants, { cleanCorpus: corpus }),
    );
    const b = acceptDelta(widenSearch(3000), ctx(premiumSearch(), searchVariants()));
    expect(a.accepted).toBe(true);
    expect(a.summary).toEqual(b.summary);
    const silenced = acceptDelta(widenSearch(200_000), ctx(asCallRecord(premiumSearch()), variants));
    expect(silenced.accepted).toBe(false);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const before = JSON.stringify(SHOP_CONTRACTS);
    const c = ctx(premiumSearch(), searchVariants());
    const snapshot = JSON.stringify(c);
    const r1 = acceptDelta(widenSearch(200_000), c);
    const r2 = acceptDelta(widenSearch(200_000), c);
    expect(r1).toEqual(r2);
    expect(JSON.stringify(SHOP_CONTRACTS)).toBe(before);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});

describe('acceptDelta: declared outputSchemas (as the live proxy checks them)', () => {
  it('rejects M7 (price as a string) on get_product on outputSchema before and after an accepted widening', () => {
    const variants = productVariants();
    const m7 = variants.find((v) => v.mutant === 'M7');
    if (!m7?.result) throw new Error('no M7 variant');
    // Without the declared schema (the gate before this fix) M7 verifies: price.range skips strings.
    const bare = evaluate(findContract(SHOP_CONTRACTS, 'get_product'), {
      args: m7.args,
      result: m7.result,
      now: new Date(m7.now),
      upstream: m7.upstream,
    });
    expect(bare.verdict).toBe('verified');
    // With it, as the proxy evaluates, M7 violates shop.get_product/outputSchema only.
    expect(violatedIds(m7)).toEqual([PRODUCT_SCHEMA]);

    const r = acceptDelta(widenProduct(3000), ctx(premiumProduct(), variants));
    expect(r.reasons).toEqual([]);
    expect(r.accepted).toBe(true);
    // M1, M5 and M7 are rejected before and after (M2, $24.99, is in range); without the declared
    // schema M7 would not count.
    expect(r.summary.mutation).toEqual({ total: 4, rejectedBefore: 3, rejectedAfter: 3 });
    const noM7 = acceptDelta(
      widenProduct(3000),
      ctx(
        premiumProduct(),
        variants.filter((v) => v.mutant !== 'M7'),
      ),
    );
    expect(noM7.summary.mutation).toEqual({ total: 3, rejectedBefore: 2, rejectedAfter: 2 });
    if (!r.proposed) throw new Error('no proposal');
    expect(violatedIds(m7, r.proposed)).toEqual([PRODUCT_SCHEMA]);
  });

  it('sees a variant lost on outputSchema by a contract-level override', () => {
    // An override that admits a string price (allowed: it amends the trigger's contract, but not a
    // property the trigger violates) is caught by scope; with the declared schema the gate also
    // sees M7 no longer rejected on outputSchema.
    const loose = shopOutputSchemas().get_product as { properties: Record<string, unknown> };
    const delta: ContractDelta = {
      rationale: 'x',
      ops: [
        ...widenProduct(3000).ops,
        {
          op: 'setOutputSchema',
          contractId: 'shop.get_product',
          outputSchema: {
            ...loose,
            properties: { ...loose.properties, price: { type: ['number', 'string', 'null'] } },
          },
        },
      ],
    };
    const r = acceptDelta(delta, ctx(premiumProduct(), productVariants()));
    expect(r.accepted).toBe(false);
    expect(r.findings).toContainEqual(expect.objectContaining({ check: 'scope', property: PRODUCT_SCHEMA }));
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        check: 'mutation',
        property: PRODUCT_SCHEMA,
        message: expect.stringContaining('disables the property'),
      }),
    );
  });

  it('rejects a delta whose trigger still violates the declared outputSchema', () => {
    // The premium p-1004 trigger also drops `in_stock`, which shop-mcp declares required.
    const trigger = edit(premiumProduct(), 'benign-premium-p-1004-no-stock', (_b, out) => {
      delete out.in_stock;
    });
    expect(violatedIds(trigger).sort()).toEqual([PRODUCT_SCHEMA, PRODUCT_RANGE].sort());
    const r = acceptDelta(widenProduct(3000), ctx(trigger, productVariants(trigger)));
    expect(r.accepted).toBe(false);
    expect(r.summary.trigger).toEqual({ before: 'violated', after: 'violated' });
    expect(r.findings).toContainEqual(
      expect.objectContaining({ check: 'trigger', message: expect.stringContaining(PRODUCT_SCHEMA) }),
    );
  });

  it('fails closed without declared outputSchemas, or when they miss a tool', () => {
    const missing = { ...ctx(premiumProduct(), productVariants()) } as Partial<GateContext>;
    delete missing.declaredOutputSchemas;
    const r = acceptDelta(widenProduct(3000), missing as GateContext);
    expect(r.accepted).toBe(false);
    expect(r.findings).toEqual([
      expect.objectContaining({ check: 'input', message: expect.stringContaining('tools/list') }),
    ]);

    const { get_order: _drop, ...partial } = shopOutputSchemas();
    const r2 = acceptDelta(
      widenProduct(3000),
      ctx(premiumProduct(), productVariants(), { declaredOutputSchemas: partial }),
    );
    expect(r2.accepted).toBe(false);
    // One finding for the tool, not one per case (get_order appears in the corpus and in D5).
    expect(r2.findings).toEqual([
      expect.objectContaining({ check: 'input', message: expect.stringContaining('tool get_order') }),
    ]);

    // A tool that declares no outputSchema is covered by an explicit null.
    const r3 = acceptDelta(
      widenProduct(3000),
      ctx(premiumProduct(), productVariants(), { declaredOutputSchemas: { ...partial, get_order: null } }),
    );
    expect(r3.accepted).toBe(true);
  });
});
