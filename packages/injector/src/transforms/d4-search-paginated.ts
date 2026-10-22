// D4 (pagination): search results come in pages of 5 with an offset `next_cursor`; `total` still
// counts every match. The vendor also reports its new dated version on every response.
import type { InjectorTransform } from '../transform.ts';

const PAGE_SIZE = 5;

const transform: InjectorTransform = {
  description: 'GET /products: results paginated, 5 per page, with next_cursor; version 2026-10-01',
  setHeaders: { 'vendor-api-version': '2026-10-01' },
  response(req, res) {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as { items?: unknown[]; next_cursor?: unknown };
    if (!Array.isArray(body.items)) return undefined;
    const all = body.items;
    const offset = Number(req.query.get('cursor') ?? '0') || 0;
    body.items = all.slice(offset, offset + PAGE_SIZE);
    body.next_cursor = offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : null;
    return { ...res, body: JSON.stringify(body) };
  },
};

export default transform;
