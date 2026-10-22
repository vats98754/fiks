// D5 (timestamp format): order `created_at` is epoch milliseconds instead of ISO-8601, on both the
// create response and the order resource. The vendor also reports its new dated version on every
// response.
import type { InjectorTransform } from '../transform.ts';

const transform: InjectorTransform = {
  description: 'POST /orders and GET /orders/{id}: created_at is epoch ms; version 2026-10-01',
  setHeaders: { 'vendor-api-version': '2026-10-01' },
  response(_req, res) {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as { created_at?: unknown };
    if (typeof body.created_at !== 'string') return undefined;
    const ms = Date.parse(body.created_at);
    if (Number.isNaN(ms)) return undefined;
    body.created_at = ms;
    return { ...res, body: JSON.stringify(body) };
  },
};

export default transform;
