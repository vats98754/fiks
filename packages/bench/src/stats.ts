/** n choose k. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * pass^k (tau-bench): the chance that k independent trials of a task all pass, estimated per
 * task as C(c, k) / C(n, k) from c passes in n trials, then averaged over tasks. A task with
 * fewer than k trials counts as 0 here (the legacy behaviour); `passHatKCurve` never asks for
 * such a k, so its estimates are unbiased.
 */
export function passHatK(perTask: { n: number; c: number }[], k: number): number {
  if (perTask.length === 0) return 0;
  const sum = perTask.reduce((s, t) => s + (t.n >= k ? choose(t.c, k) / choose(t.n, k) : 0), 0);
  return sum / perTask.length;
}

/**
 * The largest k for which pass^k is unbiased for every task: the smallest per-task trial count
 * (0 when there are no tasks). Trials lost to infrastructure errors are not counted in n.
 */
export function maxK(perTask: { n: number }[]): number {
  return perTask.length === 0 ? 0 : Math.min(...perTask.map((t) => t.n));
}

/**
 * pass^1 .. pass^K with K = `maxK(perTask)` (or `upTo`, whichever is smaller). Per task,
 * C(c, k) / C(n, k) is the unbiased estimator of p^k from n Bernoulli trials (Chen et al. 2021,
 * Yao et al. 2024), so the task mean is unbiased for the mean of p_t^k.
 */
export function passHatKCurve(perTask: { n: number; c: number }[], upTo?: number): number[] {
  const K = Math.min(maxK(perTask), upTo ?? Number.POSITIVE_INFINITY);
  return Array.from({ length: K }, (_, i) => passHatK(perTask, i + 1));
}

/** Two-sided 95% normal quantile. */
export const Z95 = 1.959963984540054;

export interface Interval {
  /** Point estimate. */
  p: number;
  lo: number;
  hi: number;
}

/**
 * Wilson score interval for `successes` out of `n` (Brown, Cai and DasGupta 2001). `successes`
 * may be fractional (an estimated rate times n). n = 0 gives the uninformative [0, 1].
 */
export function wilson(successes: number, n: number, z = Z95): Interval {
  if (n <= 0) return { p: 0, lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // The bounds are exactly 0 and 1 at the edges (floating point would leave 0.9999999999999999).
  return {
    p,
    lo: successes <= 0 ? 0 : Math.max(0, centre - half),
    hi: successes >= n ? 1 : Math.min(1, centre + half),
  };
}

/**
 * pass^1 .. pass^K, each with a 95% interval. Tasks are the unit: the interval is the Wilson
 * interval of the estimate over the number of tasks (pass^k is a mean over tasks of a per-task
 * probability, so more trials of one task say little about the next task). Descriptive only;
 * no paper test uses it (PLAN 9.2, E11).
 */
export function passHatKWithCi(perTask: { n: number; c: number }[], upTo?: number): Interval[] {
  const T = perTask.length;
  return passHatKCurve(perTask, upTo).map((est) => {
    const ci = wilson(est * T, T);
    return { p: est, lo: ci.lo, hi: ci.hi };
  });
}

/** Rounding used in every summary (4 places, as in the committed summary.json). */
export const round4 = (x: number) => Number(x.toFixed(4));
