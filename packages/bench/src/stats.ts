/** n choose k. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * pass^k (tau-bench): the chance that k independent trials of a task all pass, estimated per
 * task as C(c, k) / C(n, k) from c passes in n trials, then averaged over tasks.
 */
export function passHatK(perTask: { n: number; c: number }[], k: number): number {
  if (perTask.length === 0) return 0;
  const sum = perTask.reduce((s, t) => s + (t.n >= k ? choose(t.c, k) / choose(t.n, k) : 0), 0);
  return sum / perTask.length;
}
