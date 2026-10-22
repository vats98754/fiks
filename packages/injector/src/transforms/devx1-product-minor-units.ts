// DEV-X1 (build-phase dev drift, silent): the single-product resource moves to minor units. `price`
// becomes an integer amount in cents and the `currency` field moves after it, next to the amount.
// Search results are unchanged, status codes are unchanged, the spec and the version header are
// unchanged (no release is announced).
import type { InjectorTransform } from '../transform.ts';

const transform: InjectorTransform = {
  description: 'GET /products/{id}: price in minor units (integer cents); currency moved after price',
  response(_req, res) {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as Record<string, unknown>;
    if (typeof body.price !== 'number') return undefined;
    const { price, currency, ...rest } = body;
    return {
      ...res,
      body: JSON.stringify({ ...rest, price: Math.round(price * 100), currency }),
    };
  },
};

export default transform;
