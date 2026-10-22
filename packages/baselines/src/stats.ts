// Statistical tests for B-STAT, dependency-free and deterministic. Follows scipy's definitions:
// ks_2samp (two-sided, exact lattice-path p-value), chisquare, a pooled two-proportion z-test,
// wasserstein_distance and spatial.distance.jensenshannon (natural log).

/** ln Γ(x), Lanczos approximation (g = 7, n = 9); accurate to ~1e-15 for x > 0. */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised upper incomplete gamma Q(a, x) (Numerical Recipes gser / gcf). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Two-sided p-value of a standard normal statistic: erfc(|z|/√2) = Q(1/2, z²/2). */
export function normalTwoSidedP(z: number): number {
  return gammaQ(0.5, (z * z) / 2);
}

const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);

export interface Ks2Result {
  statistic: number;
  pValue: number;
}

/**
 * scipy.stats.ks_2samp(x, y, alternative='two-sided', method='exact'): D = sup|F_x - F_y| over the
 * pooled sample; p = P(D' >= D) over uniformly random interleavings (lattice paths), as scipy does
 * for ties too.
 */
export function ks2samp(x: number[], y: number[]): Ks2Result {
  const n = x.length;
  const m = y.length;
  if (n === 0 || m === 0) throw new Error('ks2samp needs two non-empty samples');
  const a = sortNum(x);
  const b = sortNum(y);
  // Integer statistic: max |i*m - j*n| at the pooled distinct values (D = dInt / (n*m)).
  let i = 0;
  let j = 0;
  let dInt = 0;
  while (i < n || j < m) {
    const v = Math.min(
      i < n ? (a[i] as number) : Number.POSITIVE_INFINITY,
      j < m ? (b[j] as number) : Number.POSITIVE_INFINITY,
    );
    while (i < n && a[i] === v) i++;
    while (j < m && b[j] === v) j++;
    dInt = Math.max(dInt, Math.abs(i * m - j * n));
  }
  if (dInt === 0) return { statistic: 0, pValue: 1 };
  // P(every lattice point stays strictly inside |i*m - j*n| < dInt), one row at a time.
  const row = new Float64Array(m + 1);
  row[0] = 1;
  for (let jj = 1; jj <= m; jj++) row[jj] = jj * n < dInt ? (row[jj - 1] as number) : 0;
  for (let ii = 1; ii <= n; ii++) {
    for (let jj = 0; jj <= m; jj++) {
      if (Math.abs(ii * m - jj * n) >= dInt) {
        row[jj] = 0;
        continue;
      }
      const up = (row[jj] as number) * (ii / (ii + jj));
      const left = jj > 0 ? (row[jj - 1] as number) * (jj / (ii + jj)) : 0;
      row[jj] = up + left;
    }
  }
  const inside = row[m] as number;
  return { statistic: dInt / (n * m), pValue: Math.min(1, Math.max(0, 1 - inside)) };
}

/** scipy.stats.chisquare(f_obs, f_exp): statistic and p with k - 1 degrees of freedom. */
export function chiSquare(obs: number[], exp: number[]): { statistic: number; pValue: number } {
  let stat = 0;
  for (let k = 0; k < obs.length; k++) {
    const e = exp[k] as number;
    const o = obs[k] as number;
    stat += e === 0 ? (o === 0 ? 0 : Number.POSITIVE_INFINITY) : ((o - e) * (o - e)) / e;
  }
  const df = obs.length - 1;
  if (df < 1) return { statistic: stat, pValue: 1 };
  return { statistic: stat, pValue: gammaQ(df / 2, stat / 2) };
}

/** Pooled two-proportion z-test on the share of `category` in two samples (two-sided p). */
export function proportionZTest(ref: unknown[], cur: unknown[], category: unknown): number {
  const k1 = ref.filter((v) => v === category).length;
  const k2 = cur.filter((v) => v === category).length;
  const n1 = ref.length;
  const n2 = cur.length;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return k1 / n1 === k2 / n2 ? 1 : 0;
  return normalTwoSidedP((k1 / n1 - k2 / n2) / se);
}

/** scipy.stats.wasserstein_distance(u, v) for equal-weight samples. */
export function wasserstein(u: number[], v: number[]): number {
  const a = sortNum(u);
  const b = sortNum(v);
  const all = sortNum([...a, ...b]);
  let i = 0;
  let j = 0;
  let dist = 0;
  for (let k = 0; k < all.length - 1; k++) {
    const x = all[k] as number;
    while (i < a.length && (a[i] as number) <= x) i++;
    while (j < b.length && (b[j] as number) <= x) j++;
    dist += Math.abs(i / a.length - j / b.length) * ((all[k + 1] as number) - x);
  }
  return dist;
}

/** Population standard deviation (numpy std, ddof = 0). */
export function stdPop(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / xs.length);
}

/** scipy.spatial.distance.jensenshannon(p, q) (natural log): sqrt of the JS divergence. */
export function jensenShannon(p: number[], q: number[]): number {
  const sp = p.reduce((s, x) => s + x, 0);
  const sq = q.reduce((s, x) => s + x, 0);
  let js = 0;
  for (let k = 0; k < p.length; k++) {
    const pk = (p[k] as number) / sp;
    const qk = (q[k] as number) / sq;
    const mk = (pk + qk) / 2;
    if (pk > 0) js += 0.5 * pk * Math.log(pk / mk);
    if (qk > 0) js += 0.5 * qk * Math.log(qk / mk);
  }
  return Math.sqrt(Math.max(0, js));
}

/** numpy.histogram_bin_edges(data, bins='sturges'). */
export function sturgesEdges(data: number[]): number[] {
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const bins = Math.ceil(Math.log2(data.length)) + 1;
  if (lo === hi) return [lo - 0.5, hi + 0.5];
  return Array.from({ length: bins + 1 }, (_, k) => lo + ((hi - lo) * k) / bins);
}

/** Counts per bin (numpy.histogram semantics: last bin closed). */
export function histogram(data: number[], edges: number[]): number[] {
  const counts = new Array<number>(edges.length - 1).fill(0);
  const last = edges.length - 2;
  for (const x of data) {
    for (let k = 0; k <= last; k++) {
      if (x >= (edges[k] as number) && (x < (edges[k + 1] as number) || (k === last && x === edges[k + 1]))) {
        counts[k] = (counts[k] as number) + 1;
        break;
      }
    }
  }
  return counts;
}
