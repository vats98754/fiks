// D2 (silent rename): the product resource renames `price` to `unit_amount`; the spec still says
// `price`. The vendor also reports its new dated version on every response.
import type { InjectorTransform } from '../transform.ts';

const transform: InjectorTransform = {
  description: 'GET /products/{id}: price is renamed to unit_amount; version 2026-10-01',
  setHeaders: { 'vendor-api-version': '2026-10-01' },
  response(_req, res) {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as Record<string, unknown>;
    if (!('price' in body)) return undefined;
    const { price, ...rest } = body;
    return { ...res, body: JSON.stringify({ ...rest, unit_amount: price }) };
  },
};

export default transform;
