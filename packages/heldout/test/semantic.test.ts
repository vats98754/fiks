// Semantic equality (PLAN 3.0 criterion 2): null == absent, float tolerance, key order, instants,
// error == empty on invalid inputs, NFC strings, ordered vs unordered arrays.
import { describe, expect, test } from 'vitest';
import {
  classifyOutput,
  matchesTruth,
  outputsEquivalent,
  semanticDiff,
  semanticEqual,
} from '../src/semantic.ts';

describe('semanticEqual', () => {
  test('null == absent, at any depth', () => {
    expect(semanticEqual({ a: 1, b: null }, { a: 1 })).toBe(true);
    expect(semanticEqual({ a: { x: null } }, { a: {} })).toBe(true);
    expect(semanticEqual(null, undefined)).toBe(true);
    expect(semanticEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    expect(semanticEqual({ a: null }, { a: false })).toBe(false);
  });

  test('integers exact, floats within 1e-9 relative', () => {
    expect(semanticEqual(1199, 1199)).toBe(true);
    expect(semanticEqual(1199, 1200)).toBe(false);
    expect(semanticEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(semanticEqual(749.5, 749.5 + 1e-7)).toBe(true); // |d| <= 1e-9 * 749.5
    expect(semanticEqual(749.5, 749.5 + 1e-5)).toBe(false);
    expect(semanticEqual(1e-12, 2e-12)).toBe(true); // max(1, ...) floor
    expect(semanticEqual(11.99, 1199)).toBe(false);
  });

  test('key order is ignored; arrays are ordered by default', () => {
    expect(semanticEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(semanticEqual([1, 2], [2, 1])).toBe(false);
    expect(
      semanticDiff({ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'a' }] }),
    ).toEqual(['items[0].id', 'items[1].id']);
  });

  test('arrays the domain marks unordered compare as multisets', () => {
    const opts = { unorderedPaths: ['items', 'items[*].tags'] };
    expect(
      semanticEqual({ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'a' }] }, opts),
    ).toBe(true);
    expect(
      semanticEqual(
        { items: [{ id: 'a', tags: ['x', 'y'] }] },
        { items: [{ id: 'a', tags: ['y', 'x'] }] },
        opts,
      ),
    ).toBe(true);
    expect(
      semanticEqual({ items: [{ id: 'a' }, { id: 'a' }] }, { items: [{ id: 'a' }, { id: 'b' }] }, opts),
    ).toBe(false);
  });

  test('timestamps compare as instants', () => {
    expect(semanticEqual('2026-10-01T12:00:00.000Z', '2026-10-01T12:00:00Z')).toBe(true);
    expect(semanticEqual('2026-10-01T14:00:00+02:00', '2026-10-01T12:00:00.000Z')).toBe(true);
    expect(semanticEqual('2026-10-01T12:00:00.000Z', '1970-01-01T00:00:00.000Z')).toBe(false);
    // Not an instant on both sides: compared as strings.
    expect(semanticEqual('2026-10-01', '2026-10-01T00:00:00Z')).toBe(false);
  });

  test('strings are NFC-exact', () => {
    expect(semanticEqual('café', 'café')).toBe(true);
    expect(semanticEqual('Cafe', 'cafe')).toBe(false);
  });

  test('type mismatches differ', () => {
    expect(semanticEqual('1199', 1199)).toBe(false);
    expect(semanticEqual({}, [])).toBe(false);
  });
});

describe('tool outputs', () => {
  const data = (v: unknown) => ({ structuredContent: v, content: [] });
  const err = { isError: true, content: [{ type: 'text', text: 'No product with id p-0000.' }] };
  const empty = { content: [] };

  test('classifyOutput', () => {
    expect(classifyOutput(err)).toEqual({ kind: 'error' });
    expect(classifyOutput(empty)).toEqual({ kind: 'empty' });
    expect(classifyOutput(null)).toEqual({ kind: 'empty' });
    expect(classifyOutput(data({ a: 1 }))).toEqual({ kind: 'data', value: { a: 1 } });
  });

  test('error == empty only for inputs truth() marks invalid', () => {
    expect(outputsEquivalent(err, empty, { inputValid: false })).toBe(true);
    expect(outputsEquivalent(err, empty, { inputValid: true })).toBe(false);
    expect(outputsEquivalent(err, data({ id: 'x' }), { inputValid: false })).toBe(false);
    // Two errors are equal whatever their messages say.
    expect(outputsEquivalent(err, { isError: true, content: [{ type: 'text', text: 'other' }] })).toBe(true);
    expect(outputsEquivalent(data({ price: 1199, b: null }), data({ price: 1199 }))).toBe(true);
  });

  test('matchesTruth', () => {
    expect(matchesTruth(err, { inputValid: false, expected: null })).toBe(true);
    expect(matchesTruth(empty, { inputValid: false, expected: null })).toBe(true);
    expect(matchesTruth(data({ id: 'p' }), { inputValid: false, expected: null })).toBe(false);
    expect(matchesTruth(data({ price: 11.99 }), { inputValid: true, expected: { price: 11.99 } })).toBe(true);
    expect(matchesTruth(data({ price: 1199 }), { inputValid: true, expected: { price: 11.99 } })).toBe(false);
    expect(matchesTruth(err, { inputValid: true, expected: { price: 11.99 } })).toBe(false);
  });
});
