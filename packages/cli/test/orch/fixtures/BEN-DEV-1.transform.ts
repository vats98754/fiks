// BEN-DEV-1 (benign evolution, dev only; ORCH test fixture): the vendor starts selling a premium
// laptop at $2,500. Laptop searches list it last and count it in `total`; nothing else changes
// (same fields, units, version header and spec). The contract's $2,000 price ceiling flags it,
// although the data is correct: the right fiks outcome is a contract update, not a code fix.
import type { InjectorTransform } from '../../../../injector/src/transform.ts';

const PREMIUM = {
  id: 'p-1099',
  name: 'Summit 17 Pro Laptop',
  category: 'laptop',
  currency: 'USD',
  stock: 3,
  price: 2500,
};

const transform: InjectorTransform = {
  description: 'GET /products?q=laptop: a new $2,500 laptop (p-1099) is listed last; total counts it',
  response(req, res) {
    if (res.status !== 200 || !/laptop/i.test(req.query.get('q') ?? '')) return undefined;
    const body = JSON.parse(res.body) as { items?: unknown[]; total?: number };
    if (!Array.isArray(body.items)) return undefined;
    body.items.push({ ...PREMIUM });
    if (typeof body.total === 'number') body.total += 1;
    return { ...res, body: JSON.stringify(body) };
  },
};

export default transform;
