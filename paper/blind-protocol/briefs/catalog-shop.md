# Catalog brief: shop

You are writing catalog data for the Vendor Shop API, an online store for electronics and
accessories. The public documentation of the API is in `docs/`. Read it first.

Write exactly 25 new products that this store could plausibly sell. Each product has:

- `name`: the display name a customer sees.
- `category`: a short lower-case category word. You may use the categories the docs mention or
  introduce new ones that fit the store.
- `price`: the unit price as a JSON number, in the product's `currency`.
- `currency`: the currency code of the price.
- `stock`: the number of units in stock, as a JSON integer.

Do not write an `id` field: identifiers are assigned when your products are loaded. Write
products a real store would list: realistic names, categories, prices and stock levels. Vary
them; do not copy each other's products. You may read the files in your working directory; you
have no other source of information.

Return your products as the structured result `{"entities": [ ... ]}`.
