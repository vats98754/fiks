import { expect, test } from 'vitest';
import { startHarness } from '../src/harness.ts';

test('shop-mcp over stdio, through the tap, against vendor v1 and v2 (D2)', { timeout: 30_000 }, async () => {
  const v1 = await startHarness({ vendor: 'v1' });
  try {
    const { result, http } = await v1.call('get_product', { id: 'p-1001' });
    expect(result.structuredContent).toMatchObject({ id: 'p-1001', price: 1199 });
    expect(http.map((e) => `${e.request.method} ${e.request.url}`)).toEqual(['GET /products/p-1001']);
  } finally {
    await v1.close();
  }
  const v2 = await startHarness({ vendor: 'v2', drifts: 'D2' });
  try {
    const { result } = await v2.call('get_product', { id: 'p-1001' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ id: 'p-1001', price: null });
  } finally {
    await v2.close();
  }
});
