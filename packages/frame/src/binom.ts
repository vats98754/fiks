// Exact binomial tail for the H1 test (PLAN 3.1): crit(N_E, 0.02, alpha) and the power at
// pi = 0.01 and 0.005, recorded in the FrameSpec at F4b. pmf by recursion in log space.

export const H1_P0 = 0.02;
export const H1_ALPHA = 0.0125;
/** The smallest N_E at which the test can reject at all (0.98^N <= 0.0125; PLAN 3.1). */
export const NE_MIN_REJECTABLE = 217;

/** P(Bin(n, p) <= k). */
export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const lq = Math.log1p(-p);
  const ratio = Math.log(p) - lq;
  let logPmf = n * lq;
  let sum = Math.exp(logPmf);
  for (let i = 0; i < k; i++) {
    logPmf += Math.log(n - i) - Math.log(i + 1) + ratio;
    sum += Math.exp(logPmf);
  }
  return Math.min(1, sum);
}

/** The largest k with P(Bin(n, p0) <= k) <= alpha, or -1 when even k = 0 exceeds alpha. */
export function binomCrit(n: number, p0: number, alpha: number): number {
  let k = -1;
  while (k + 1 <= n && binomCdf(k + 1, n, p0) <= alpha) k++;
  return k;
}

export interface H1Design {
  crit: number;
  power: { pi01: number; pi005: number };
  underpowered: boolean;
  m: 3 | 4;
}

/** crit, power and the N_E rule's flags for a realised N_E (PLAN 3.1 "N_E rule"). */
export function h1Design(ne: number): H1Design {
  const crit = ne > 0 ? binomCrit(ne, H1_P0, H1_ALPHA) : -1;
  const power = {
    pi01: crit >= 0 ? binomCdf(crit, ne, 0.01) : 0,
    pi005: crit >= 0 ? binomCdf(crit, ne, 0.005) : 0,
  };
  return { crit, power, underpowered: power.pi01 < 0.5, m: ne < NE_MIN_REJECTABLE ? 3 : 4 };
}
