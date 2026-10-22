// D3 (lost write): POST /orders still answers 200 with an id, but the order is kept only when the
// request carries an Idempotency-Key. The injector remembers acknowledged-but-unkept order ids and
// answers 404 for them afterwards, exactly as the vendor does for an unknown order. The vendor also
// reports its new dated version on every response.
import type { InjectorTransform } from '../transform.ts';

const DROPPED = 'droppedOrders';
const NOT_FOUND = JSON.stringify({ error: 'not_found', message: 'Unknown order.' });

const transform: InjectorTransform = {
  description: 'POST /orders persists only with Idempotency-Key (200 + id either way); version 2026-10-01',
  setHeaders: { 'vendor-api-version': '2026-10-01' },
  response(req, res, ctx) {
    let dropped = ctx.state.get(DROPPED) as Set<string> | undefined;
    if (!dropped) {
      dropped = new Set();
      ctx.state.set(DROPPED, dropped);
    }
    if (req.method === 'POST' && req.path === '/orders') {
      if (res.status !== 200) return undefined;
      const id = (JSON.parse(res.body) as { id?: unknown }).id;
      if (typeof id !== 'string') return undefined;
      // The latest acknowledgement of an id decides (ids restart after a vendor reset).
      if (req.headers['idempotency-key']) dropped.delete(id);
      else dropped.add(id);
      return undefined;
    }
    if (req.method === 'GET' && req.path.startsWith('/orders/')) {
      const id = decodeURIComponent(req.path.slice('/orders/'.length));
      if (res.status === 200 && dropped.has(id)) return { ...res, status: 404, body: NOT_FOUND };
    }
    return undefined;
  },
};

export default transform;
