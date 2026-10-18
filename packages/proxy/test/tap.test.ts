import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startTap, type Tap } from '../src/index.ts';

let upstreamUrl = '';
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    res.writeHead(201, {
      'content-type': 'application/json',
      'set-cookie': 'secret=1',
      'x-seen': req.url ?? '',
    });
    res.end(JSON.stringify({ echo: body || null }));
  });
});
let tap: Tap;

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  tap = await startTap(upstreamUrl);
});
afterAll(async () => {
  await tap.close();
  upstream.close();
});

test('forwards unchanged and records the exchange', async () => {
  const res = await fetch(`${tap.url}/orders?x=1`, {
    method: 'POST',
    headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ echo: '{"a":1}' });
  const [ex] = tap.take();
  expect(ex?.request).toMatchObject({ method: 'POST', url: '/orders?x=1', body: '{"a":1}' });
  expect(ex?.request.headers.authorization).toBe('[REDACTED]');
  expect(ex?.response.headers['set-cookie']).toBe('[REDACTED]');
  expect(ex?.response.headers['x-seen']).toBe('/orders?x=1');
  expect(ex?.response).toMatchObject({ status: 201, body: '{"echo":"{\\"a\\":1}"}' });
});

test('take() returns only exchanges since the last take', async () => {
  await fetch(`${tap.url}/a`);
  await fetch(`${tap.url}/b`);
  expect(tap.take().map((e) => e.request.url)).toEqual(['/a', '/b']);
  expect(tap.take()).toEqual([]);
  expect(tap.exchanges).toEqual([]);
});
