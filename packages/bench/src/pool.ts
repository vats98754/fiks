/**
 * Runs `fn` over `items` with at most `workers` calls in flight. Worker w (0-based) takes the
 * next unstarted item whenever it is free, so the item-to-worker mapping depends on timing, but
 * the result array is always in item order. After a failure no new item starts; the first error
 * is thrown once every in-flight call has settled.
 */
export async function runPool<T, R>(
  items: readonly T[],
  workers: number,
  fn: (item: T, worker: number, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error(`workers must be an integer >= 1: ${workers}`);
  const results: R[] = new Array(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const loop = async (worker: number) => {
    while (failure === null && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i] as T, worker, i);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, (_, w) => loop(w)));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
