// D1 (unit drift): search results carry prices in integer cents under the same `price` field.
// The vendor also reports its new dated version on every response.
import type { InjectorTransform } from '../transform.ts';

const transform: InjectorTransform = {
  description: 'GET /products: items[].price becomes integer cents (same field name); version 2026-10-01',
  setHeaders: { 'vendor-api-version': '2026-10-01' },
  response(_req, res) {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as { items?: { price?: unknown }[] };
    if (!Array.isArray(body.items)) return undefined;
    for (const item of body.items) {
      if (typeof item.price === 'number') item.price = Math.round(item.price * 100);
    }
    return { ...res, body: JSON.stringify(body) };
  },
};

export default transform;
