# Vendor Shop API

The Vendor Shop API is a small JSON-over-HTTP API for a product catalog and orders. This page
describes the published behaviour of API version `2026-01-01`. The machine-readable contract is
`openapi.json` next to this folder; where the two differ, `openapi.json` is authoritative.

## Conventions

- All request and response bodies are JSON (`content-type: application/json`).
- Every response carries a `vendor-api-version` header naming the API version that produced it
  (a date, for example `2026-01-01`).
- Errors use an HTTP error status and a body of the form `{"error": "<code>", "message": "<text>"}`,
  for example `not_found` or `invalid_order`.
- Money amounts are JSON numbers in the currency named by the product's `currency` field (US
  dollars, `USD`, in the current catalog). Amounts may have a fractional part (cents).
- Timestamps are ISO-8601 strings in UTC, for example `2026-01-01T09:30:00.000Z`.
- Identifiers are opaque strings. Clients must not derive meaning from their format.

## Products

A product has these fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Product identifier. |
| `name` | string | Display name. |
| `category` | string | Category, for example `laptop`, `monitor`, `cable`, `dock` or `keyboard`. |
| `price` | number or null | Unit price, in `currency`. |
| `currency` | string | ISO-4217 currency code. |
| `stock` | integer | Units currently in stock. |

### Search products: `GET /products?q=<query>`

Returns the products whose name contains `q` (case-insensitive substring match) or whose
category equals `q`. An empty or missing `q` matches every product.

```
{
  "items": [{ "id": <string>, "name": <string>, "category": <string>, "price": <number>, "currency": <string>, "stock": <integer> }],
  "total": <integer>,
  "next_cursor": <string or null>
}
```

- `items`: the matching products, in catalog order.
- `total`: the number of products that match the query.
- `next_cursor`: a cursor for the next page of results, or `null` when there are no more
  results. The optional `cursor` query parameter requests the page that a previous response's
  `next_cursor` points to. In this version every match is returned on the first page, so
  `next_cursor` is `null`.

A query that matches nothing returns `200` with an empty `items` list and `total` of zero.

### Get a product: `GET /products/{id}`

Returns one product object (fields above). An unknown id returns `404` with
`{"error": "not_found", "message": "Unknown product."}`.

## Orders

An order has these fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Order identifier. |
| `status` | string | Order status (`confirmed` once accepted). |
| `items` | array | Order lines: `{ "product_id", "quantity", "unit_price" }`. |
| `total` | number | Sum of `unit_price` times `quantity` over all lines, rounded to cents. |
| `created_at` | string | When the order was placed (ISO-8601, UTC). |

`unit_price` is the product's price at the time the order was placed.

### Create an order: `POST /orders`

Request body:

```
{ "items": [{ "product_id": <string>, "quantity": <positive integer> }] }
```

- `items` must be a non-empty array.
- Each `product_id` must name an existing product.
- Each `quantity` must be a positive integer.

Optional header: `Idempotency-Key`. Recommended: a unique key per order attempt.

On success the API returns `200` with the created order (fields above); the order can then be
read back with `GET /orders/{id}`. An invalid body returns `400` with
`{"error": "invalid_order", "message": "<what is wrong>"}`. Each successful call places a new
order.

### Get an order: `GET /orders/{id}`

Returns one order (fields above). An unknown id returns `404` with
`{"error": "not_found", "message": "Unknown order."}`.

## Other endpoints

- `GET /openapi.json` returns the published OpenAPI document.
