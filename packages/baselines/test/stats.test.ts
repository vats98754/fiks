import { describe, expect, test } from 'vitest';
import {
  chiSquare,
  gammaQ,
  histogram,
  jensenShannon,
  ks2samp,
  normalTwoSidedP,
  proportionZTest,
  sturgesEdges,
  wasserstein,
} from '../src/stats.ts';

// Golden values from scipy 1.14.1 / numpy (stats.ks_2samp(method='exact'), stats.chisquare,
// stats.wasserstein_distance, spatial.distance.jensenshannon, special.gammaincc, norm.sf).
describe('stats match scipy', () => {
  test('ks_2samp exact', () => {
    const r = ks2samp([1.2, 3.4, 2.2, 5.1, 0.3, 4.4, 2.9, 3.3], [2.5, 6.1, 7.3, 4.8, 5.5, 6.6, 3.9]);
    expect(r.statistic).toBeCloseTo(0.6071428571428571, 12);
    expect(r.pValue).toBeCloseTo(0.08702408702408701, 10);
  });
  test('ks_2samp exact with ties', () => {
    const r = ks2samp([1, 2, 2, 3, 3, 3, 4, 5], [3, 3, 4, 4, 5, 5, 6, 7, 7]);
    expect(r.statistic).toBeCloseTo(0.5277777777777778, 12);
    expect(r.pValue).toBeCloseTo(0.14232825997531878, 10);
  });
  test('ks_2samp exact, larger samples', () => {
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = Array.from({ length: 25 }, (_, i) => i + 8);
    const r = ks2samp(a, b);
    expect(r.statistic).toBeCloseTo(0.26666666666666666, 12);
    expect(r.pValue).toBeCloseTo(0.23924239557526017, 9);
  });
  test('identical samples give p = 1', () => {
    expect(ks2samp([1, 2, 3], [1, 2, 3])).toEqual({ statistic: 0, pValue: 1 });
  });
  test('chisquare', () => {
    const r = chiSquare([10, 20, 30], [15, 15, 30]);
    expect(r.statistic).toBeCloseTo(3.3333333333333335, 12);
    expect(r.pValue).toBeCloseTo(0.1888756028375618, 10);
    expect(chiSquare([1, 2], [3, 0]).pValue).toBe(0);
  });
  test('gammaincc and normal tails', () => {
    expect(gammaQ(2.5, 3.7)).toBeCloseTo(0.19255043307939584, 10);
    expect(gammaQ(10, 2)).toBeCloseTo(0.9999535019249828, 10);
    expect(normalTwoSidedP(1.96)).toBeCloseTo(0.04999579029644097, 9);
    expect(normalTwoSidedP(3.1)).toBeCloseTo(0.0019352064264367124, 10);
  });
  test('wasserstein_distance', () => {
    expect(wasserstein([0, 1, 3], [5, 6, 8])).toBeCloseTo(5, 12);
    expect(wasserstein([1, 2, 2.5, 7], [0.5, 4])).toBeCloseTo(1.625, 12);
  });
  test('jensenshannon', () => {
    expect(jensenShannon([0.1, 0.4, 0.5], [0.3, 0.3, 0.4])).toBeCloseTo(0.1803596560271257, 12);
  });
  test('sturges bins and histogram', () => {
    const data = [1, 2, 3, 4, 10, 11, 12];
    expect(sturgesEdges(data)).toEqual([1, 3.75, 6.5, 9.25, 12]);
    expect(histogram(data, sturgesEdges(data))).toEqual([3, 1, 0, 3]);
  });
  test('two-proportion z-test', () => {
    expect(proportionZTest(['a', 'a', 'b'], ['a', 'a', 'b'], 'a')).toBeCloseTo(1, 12);
    expect(proportionZTest(Array(50).fill('a'), Array(50).fill('b'), 'a')).toBeLessThan(1e-6);
  });
});
