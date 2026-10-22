// Golden tests for M1-M14 (one hand-derived expected output per operator, on inputs with a single
// eligible site so the seed cannot change the answer), and the B1-B4 semantics-kept checks over
// every fixture and 25 seeds.
import { describe, expect, test } from 'vitest';
import {
  BENIGN_OPS,
  mutateRecordedResponse,
  mutateResponse,
  RESPONSE_OPS,
  type RecordedResponse,
  type ResponseOperator,
} from '../src/index.ts';
import fixtures from './fixtures/responses.json' with { type: 'json' };

type Exchange = { request: { method: string; url: string }; response: RecordedResponse };
const EXCHANGES = Object.entries(fixtures.exchanges as Record<string, Exchange>);
const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

/** Applies `op` to `json` with several seeds and checks they all give `expected`. */
function golden(op: ResponseOperator, json: unknown, expected: unknown, ctx = {}) {
  for (const seed of [1, 2, 3, 'x']) {
    const m = mutateResponse(op, json, seed, ctx);
    expect(m.applicable, `${op} seed ${seed}`).toBe(true);
    expect(m.json, `${op} seed ${seed}`).toEqual(expected);
    expect(m.body).toBe(JSON.stringify(expected));
  }
}

describe('response operators: golden outputs', () => {
  test('M1 numeric x100 (id keys excluded)', () => {
    golden('M1', { id: 'p-1', price: 12.5 }, { id: 'p-1', price: 1250 });
    golden('M1', { items: [{ price: 7.495 }, { price: 0.1 }] }, { items: [{ price: 749.5 }, { price: 10 }] });
    // Zero would not change: not a site.
    golden('M1', { page: 0, price: 2 }, { page: 0, price: 200 });
  });

  test('M2 numeric /100', () => {
    golden('M2', { id: 7, price: 1250 }, { id: 7, price: 12.5 });
    golden(
      'M2',
      { items: [{ price: 1199 }, { price: 749.5 }] },
      { items: [{ price: 11.99 }, { price: 7.495 }] },
    );
  });

  test('M3 rename from the synonym table, keeping key position', () => {
    golden('M3', { a: 1, labels: ['x'], z: 2 }, { a: 1, tags: ['x'], z: 2 });
    expect(Object.keys(mutateResponse('M3', { a: 1, labels: [], z: 2 }, 1).json as object)).toEqual([
      'a',
      'tags',
      'z',
    ]);
    // Every synonym collides: not applicable.
    const m = mutateResponse('M3', { state: 'open', status: 'x' }, 1);
    expect(m.applicable).toBe(false);
    expect(m.json).toEqual({ state: 'open', status: 'x' });
    // price -> one of its synonyms, the same one in every element.
    const p = mutateResponse('M3', { items: [{ price: 1 }, { price: 2 }] }, 5).json as {
      items: Record<string, number>[];
    };
    const k = Object.keys(p.items[0] ?? {})[0];
    expect(['unit_amount', 'amount', 'cost']).toContain(k);
    expect(p.items.map((e) => Object.keys(e))).toEqual([[k], [k]]);
  });

  test('M4 drop field', () => {
    golden('M4', { name: 'x' }, {});
    golden('M4', { items: [] }, {});
  });

  test('M5 null field (already-null fields are not sites)', () => {
    golden('M5', { name: 'x', gone: null }, { name: null, gone: null });
  });

  test('M6 truncate array to 5, total kept', () => {
    golden('M6', { items: [1, 2, 3, 4, 5, 6, 7], total: 7 }, { items: [1, 2, 3, 4, 5], total: 7 });
    expect(mutateResponse('M6', { items: [1, 2, 3, 4, 5], total: 5 }, 1).applicable).toBe(false);
  });

  test('M7 number to string', () => {
    golden('M7', { id: 3, qty: 2 }, { id: 3, qty: '2' });
  });

  test('M8 ISO-8601 to epoch ms', () => {
    golden('M8', { created_at: '2026-10-01T12:00:00.000Z' }, { created_at: 1790856000000 });
    golden('M8', { due: '2026-11-15' }, { due: Date.parse('2026-11-15') });
  });

  test('M9 epoch s <-> ms', () => {
    golden('M9', { t: 1790500000 }, { t: 1790500000000 });
    golden('M9', { t: 1790500000123 }, { t: 1790500000 });
  });

  test('M10 unknown enum value', () => {
    for (const seed of SEEDS) {
      const m = mutateResponse('M10', { id: 'o-1', status: 'confirmed' }, seed);
      expect((m.json as { status: string }).status).toMatch(/^fiks_unknown_[0-9a-f]{4}$/);
      expect((m.json as { id: string }).id).toBe('o-1');
      const u = mutateResponse('M10', { currency: 'USD' }, seed);
      expect((u.json as { currency: string }).currency).toMatch(/^FIKS_UNKNOWN_[0-9A-F]{4}$/);
    }
    // One value for the whole site.
    const many = mutateResponse('M10', { items: [{ c: 'cable' }, { c: 'dock' }] }, 3).json as {
      items: { c: string }[];
    };
    expect(many.items[0]?.c).toBe(many.items[1]?.c);
  });

  test('M11 string perturbation: one letter becomes the next letter', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      // Free text only: 'ab' or 'zz' would be enum-like and belong to M10.
      seen.add((mutateResponse('M11', { name: 'Ab' }, seed).json as { name: string }).name);
      expect(['Az', 'Za']).toContain(
        (mutateResponse('M11', { name: 'Zz' }, seed).json as { name: string }).name,
      );
    }
    expect([...seen].sort()).toEqual(['Ac', 'Bb']);
    // Ids, timestamps and enum-like strings are not sites.
    expect(mutateResponse('M11', { id: 'Abc', at: '2026-01-01', s: 'open' }, 1).applicable).toBe(false);
  });

  test('M12 identity swap', () => {
    golden('M12', { items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'a' }] });
    golden('M12', { id: 'o-0099', total: 1 }, { id: 'o-0100', total: 1 });
    golden('M12', { project_id: 77 }, { project_id: 78 });
  });

  test('M13 stale timestamp, recorded format kept', () => {
    golden('M13', { at: '2026-10-01T12:00:00Z' }, { at: '2025-08-27T12:00:00Z' });
    golden('M13', { at: '2026-10-01T12:00:00.000Z' }, { at: '2025-08-27T12:00:00.000Z' });
    golden('M13', { at: '2026-10-01T14:00:00+02:00' }, { at: '2025-08-27T14:00:00+02:00' });
    golden('M13', { d: '2026-11-15' }, { d: '2025-10-11' });
    golden('M13', { t: 1790500000 }, { t: 1790500000 - 400 * 86400 });
    golden('M13', { t: 1790500000000 }, { t: 1790500000000 - 400 * 86_400_000 });
  });

  test('M14 phantom write', () => {
    for (const seed of SEEDS) {
      const w = mutateResponse('M14', { id: 'o-5002', total: 1 }, seed, { method: 'POST' });
      const id = (w.json as { id: string }).id;
      expect(id).toMatch(/^o-9\d{3}$/);
      expect(id).not.toBe('o-5002');
      expect(w.status).toBeUndefined();
      expect((w.json as { total: number }).total).toBe(1);
    }
    const r = mutateResponse('M14', { id: 'o-5002', total: 1 }, 1, { method: 'GET' });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: 'not_found', message: 'Not found.' });
    expect(mutateResponse('M14', { id: 'o-5002' }, 1).status).toBe(404);
    expect(mutateResponse('M14', [{ id: 'a' }], 1).applicable).toBe(false);
  });
});

/** Canonical form with every array sorted: equal iff equal up to array order. */
function bag(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(bag).sort().join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${bag((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function withoutExtra(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutExtra);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !k.startsWith('fiks_extra_'))
        .map(([k, x]) => [k, withoutExtra(x)]),
    );
  }
  return v;
}

describe('benign controls keep JSON semantics (every fixture, 25 seeds)', () => {
  for (const [name, ex] of EXCHANGES) {
    const original = JSON.parse(ex.response.body);
    test(name, () => {
      for (const seed of SEEDS) {
        const b1 = mutateRecordedResponse('B1', ex.response, seed, ex.request);
        expect(bag(JSON.parse(b1.response.body))).toBe(bag(original));
        if (b1.mutation.applicable) expect(b1.response.body).not.toBe(ex.response.body);

        const b2 = mutateRecordedResponse('B2', ex.response, seed, ex.request);
        expect(b2.mutation.applicable).toBe(true);
        expect(withoutExtra(JSON.parse(b2.response.body))).toEqual(original);
        expect(b2.response.body).not.toBe(ex.response.body);

        const b3 = mutateRecordedResponse('B3', ex.response, seed, ex.request);
        expect(JSON.parse(b3.response.body)).toEqual(original);
        expect(b3.response.body).not.toBe(ex.response.body);

        const b4 = mutateRecordedResponse('B4', ex.response, seed, ex.request);
        expect(b4.response.body).toBe(ex.response.body);
        expect(b4.response.status).toBe(ex.response.status);
        expect(Object.keys(b4.response.headers).length).toBe(Object.keys(ex.response.headers).length + 1);

        for (const b of [b1, b2, b3, b4]) {
          expect(b.response.status).toBe(ex.response.status);
          expect(b.mutation.status).toBeUndefined();
        }
      }
    });
  }

  test('B1 keeps the multiset and changes the order', () => {
    for (const seed of SEEDS) {
      const m = mutateResponse('B1', { xs: [1, 2, 3] }, seed);
      const xs = (m.json as { xs: number[] }).xs;
      expect([...xs].sort()).toEqual([1, 2, 3]);
      expect(xs).not.toEqual([1, 2, 3]);
    }
    expect(mutateResponse('B1', { xs: [1, 1] }, 1).applicable).toBe(false);
  });
});

describe('response operators: properties over every fixture', () => {
  for (const [name, ex] of EXCHANGES) {
    test(name, () => {
      const before = JSON.stringify(ex);
      for (const op of RESPONSE_OPS) {
        for (const seed of SEEDS) {
          const r = mutateRecordedResponse(op, ex.response, seed, ex.request);
          if (!r.mutation.applicable) {
            expect(r.response).toEqual(ex.response);
            continue;
          }
          // A mutant always differs from the recorded response.
          expect(r.response.body !== ex.response.body || r.response.status !== ex.response.status).toBe(true);
          expect(r.mutation.site).not.toBeNull();
        }
      }
      // Pure: the input is never modified.
      expect(JSON.stringify(ex)).toBe(before);
    });
  }

  test('every M operator applies to some fixture', () => {
    for (const op of RESPONSE_OPS) {
      const hits = EXCHANGES.filter(
        ([, ex]) => mutateRecordedResponse(op, ex.response, 1, ex.request).mutation.applicable,
      );
      expect(hits.length, op).toBeGreaterThan(0);
    }
    for (const op of BENIGN_OPS) expect(op).toMatch(/^B[1-4]$/);
  });

  test('non-JSON bodies admit only B4', () => {
    const res = { status: 200, headers: { 'content-type': 'text/plain' }, body: 'hello' };
    for (const op of RESPONSE_OPS) expect(mutateRecordedResponse(op, res, 1).mutation.applicable).toBe(false);
    expect(mutateRecordedResponse('B4', res, 1).response.body).toBe('hello');
  });

  test('unknown operators throw', () => {
    expect(() => mutateResponse('M15' as ResponseOperator, {}, 1)).toThrow(/unknown response operator/);
  });
});
