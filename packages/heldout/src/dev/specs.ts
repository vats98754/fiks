// The HOLD builder's dev DriftPackages (D1-D5 on seed-v1, DEV-X1 on base-shop): hidden-test
// inputs per manifestation (PLAN 3.0 criterion 1: other inputs to the same tool, other tools that
// consume the drifted field, v1 behaviour preserved), the renamed-id rules and the manifest
// metadata. Expected outputs are not written here: build.ts computes them from vendor v1 ground
// truth. Never confirmatory.

/** A step argument taken from an earlier step's expected output: `{ $step: 0, field: 'order_id' }`. */
export interface StepRef {
  $step: number;
  field: string;
}

export interface SpecStep {
  tool: string;
  args: Record<string, unknown | StepRef>;
  upstream: 'drifted' | 'v1';
}

export interface SpecFile {
  file: string;
  title: string;
  manifestation: 'other-input' | 'other-tool' | 'v1-preserved';
  steps: SpecStep[];
}

export interface DevDriftSpec {
  id: string;
  domain: 'shop';
  base: 'seed-v1' | 'base-shop';
  ideationFamily: string;
  /** Rule file under packages/injector/fixtures/rules. */
  rule: string;
  /** Ref A, relative to the package directory. */
  refA: string;
  files: SpecFile[];
  changelog?: string;
}

const d = (tool: string, args: SpecStep['args']): SpecStep => ({ tool, args, upstream: 'drifted' });
const v1 = (tool: string, args: SpecStep['args']): SpecStep => ({ tool, args, upstream: 'v1' });
const ORACLE = (n: number) => `../../../../cli/test/oracles/D${n}.patch`;

/** Shop ids renamed for the renamed-id variant: p-1001 -> p-91001, o-5001 -> o-95001. */
export const SHOP_RENAME = {
  forward: [
    { pattern: '\\bp-(\\d{4})\\b', replace: 'p-9$1' },
    { pattern: '\\bo-(\\d{4})\\b', replace: 'o-9$1' },
  ],
  inverse: [
    { pattern: '\\bp-9(\\d{4})\\b', replace: 'p-$1' },
    { pattern: '\\bo-9(\\d{4})\\b', replace: 'o-$1' },
  ],
};

export const DEV_SPECS: DevDriftSpec[] = [
  {
    id: 'D1',
    domain: 'shop',
    base: 'seed-v1',
    ideationFamily: 'unit',
    rule: 'D1.json',
    refA: ORACLE(1),
    files: [
      {
        file: 'search-other-categories.test.ts',
        title: 'search_products prices in dollars for other categories',
        manifestation: 'other-input',
        steps: [
          d('search_products', { query: 'monitor' }),
          d('search_products', { query: 'dock' }),
          d('search_products', { query: 'keyboard' }),
        ],
      },
      {
        file: 'search-phrases.test.ts',
        title: 'search_products by name phrase, including a phrase with no match',
        manifestation: 'other-input',
        steps: [
          d('search_products', { query: 'usb4 cable' }),
          d('search_products', { query: 'Clarity 32' }),
          d('search_products', { query: 'teapot' }),
        ],
      },
      {
        file: 'search-then-order.test.ts',
        title: 'a searched product is ordered at the searched price',
        manifestation: 'other-tool',
        steps: [
          d('search_products', { query: 'thunderbolt' }),
          d('create_order', { items: [{ product_id: 'p-1102', quantity: 2 }] }),
        ],
      },
      {
        file: 'search-v1.test.ts',
        title: 'v1 search responses still read correctly',
        manifestation: 'v1-preserved',
        steps: [v1('search_products', { query: 'laptop' }), v1('search_products', { query: 'cable' })],
      },
    ],
  },
  {
    id: 'D2',
    domain: 'shop',
    base: 'seed-v1',
    ideationFamily: 'rename',
    rule: 'D2.json',
    refA: ORACLE(2),
    files: [
      {
        file: 'product-others.test.ts',
        title: 'get_product returns the price of other products',
        manifestation: 'other-input',
        steps: [
          d('get_product', { id: 'p-1004' }),
          d('get_product', { id: 'p-1101' }),
          d('get_product', { id: 'p-1008' }),
        ],
      },
      {
        file: 'product-unknown.test.ts',
        title: 'an unknown product is an error, a known one still has its price',
        manifestation: 'other-input',
        steps: [d('get_product', { id: 'p-0000' }), d('get_product', { id: 'p-1003' })],
      },
      {
        file: 'product-then-order.test.ts',
        title: 'a product looked up is ordered at its price',
        manifestation: 'other-tool',
        steps: [
          d('get_product', { id: 'p-1006' }),
          d('create_order', { items: [{ product_id: 'p-1006', quantity: 1 }] }),
        ],
      },
      {
        file: 'product-v1.test.ts',
        title: 'v1 product responses still read correctly',
        manifestation: 'v1-preserved',
        steps: [v1('get_product', { id: 'p-1001' }), v1('get_product', { id: 'p-1005' })],
      },
    ],
  },
  {
    id: 'D3',
    domain: 'shop',
    base: 'seed-v1',
    ideationFamily: 'lost-write',
    rule: 'D3.json',
    refA: ORACLE(3),
    files: [
      {
        file: 'order-single.test.ts',
        title: 'an order for one product can be read back',
        manifestation: 'other-input',
        steps: [
          d('create_order', { items: [{ product_id: 'p-1001', quantity: 1 }] }),
          d('get_order', { order_id: { $step: 0, field: 'order_id' } }),
        ],
      },
      {
        file: 'order-multi.test.ts',
        title: 'an order for several products can be read back',
        manifestation: 'other-input',
        steps: [
          d('create_order', {
            items: [
              { product_id: 'p-1101', quantity: 2 },
              { product_id: 'p-1008', quantity: 1 },
            ],
          }),
          d('get_order', { order_id: { $step: 0, field: 'order_id' } }),
        ],
      },
      {
        file: 'order-two.test.ts',
        title: 'two orders in a row are both kept',
        manifestation: 'other-tool',
        steps: [
          d('create_order', { items: [{ product_id: 'p-1005', quantity: 1 }] }),
          d('create_order', { items: [{ product_id: 'p-1007', quantity: 3 }] }),
          d('get_order', { order_id: { $step: 0, field: 'order_id' } }),
          d('get_order', { order_id: { $step: 1, field: 'order_id' } }),
        ],
      },
      {
        file: 'order-v1.test.ts',
        title: 'v1 orders still place and read back',
        manifestation: 'v1-preserved',
        steps: [
          v1('create_order', { items: [{ product_id: 'p-1004', quantity: 2 }] }),
          v1('get_order', { order_id: { $step: 0, field: 'order_id' } }),
        ],
      },
    ],
  },
  {
    id: 'D4',
    domain: 'shop',
    base: 'seed-v1',
    ideationFamily: 'pagination',
    rule: 'D4.json',
    refA: ORACLE(4),
    files: [
      {
        file: 'search-all.test.ts',
        title: 'an empty query lists every product across pages',
        manifestation: 'other-input',
        steps: [d('search_products', { query: '' })],
      },
      {
        file: 'search-small.test.ts',
        title: 'searches with one page of results and with none',
        manifestation: 'other-input',
        steps: [
          d('search_products', { query: 'laptop' }),
          d('search_products', { query: 'monitor' }),
          d('search_products', { query: 'teapot' }),
        ],
      },
      {
        file: 'search-then-order.test.ts',
        title: 'the last product of a long search can be ordered',
        manifestation: 'other-tool',
        steps: [
          d('search_products', { query: 'cable' }),
          d('create_order', { items: [{ product_id: 'p-1104', quantity: 1 }] }),
        ],
      },
      {
        file: 'search-v1.test.ts',
        title: 'v1 single-page search responses still read correctly',
        manifestation: 'v1-preserved',
        steps: [v1('search_products', { query: 'cable' }), v1('search_products', { query: '' })],
      },
    ],
  },
  {
    id: 'D5',
    domain: 'shop',
    base: 'seed-v1',
    ideationFamily: 'timestamp-format',
    rule: 'D5.json',
    refA: ORACLE(5),
    files: [
      {
        file: 'order-new.test.ts',
        title: 'a new order reports when it was placed',
        manifestation: 'other-input',
        steps: [
          d('create_order', { items: [{ product_id: 'p-1003', quantity: 1 }] }),
          d('get_order', { order_id: { $step: 0, field: 'order_id' } }),
        ],
      },
      {
        file: 'order-unknown.test.ts',
        title: 'an unknown order is an error, the seed order still has its date',
        manifestation: 'other-input',
        steps: [d('get_order', { order_id: 'o-4999' }), d('get_order', { order_id: 'o-5001' })],
      },
      {
        file: 'order-two.test.ts',
        title: 'two new orders report the same placement time',
        manifestation: 'other-tool',
        steps: [
          d('create_order', { items: [{ product_id: 'p-1102', quantity: 1 }] }),
          d('create_order', { items: [{ product_id: 'p-1008', quantity: 2 }] }),
          d('get_order', { order_id: { $step: 1, field: 'order_id' } }),
        ],
      },
      {
        file: 'order-v1.test.ts',
        title: 'v1 ISO-8601 timestamps still read correctly',
        manifestation: 'v1-preserved',
        steps: [
          v1('get_order', { order_id: 'o-5001' }),
          v1('create_order', { items: [{ product_id: 'p-1001', quantity: 1 }] }),
          v1('get_order', { order_id: { $step: 1, field: 'order_id' } }),
        ],
      },
    ],
  },
  {
    id: 'DEV-X1',
    domain: 'shop',
    base: 'base-shop',
    ideationFamily: 'unit',
    rule: 'DEV-X1.json',
    refA: 'refA.patch',
    files: [
      {
        file: 'product-others.test.ts',
        title: 'get_product returns dollar prices for other products',
        manifestation: 'other-input',
        steps: [
          d('get_product', { id: 'p-1004' }),
          d('get_product', { id: 'p-1103' }),
          d('get_product', { id: 'p-1006' }),
        ],
      },
      {
        file: 'product-unknown.test.ts',
        title: 'an unknown product is an error, a known one has a dollar price',
        manifestation: 'other-input',
        steps: [d('get_product', { id: 'p-0000' }), d('get_product', { id: 'p-1002' })],
      },
      {
        file: 'product-then-search.test.ts',
        title: 'a product and the search result for it agree on the price',
        manifestation: 'other-tool',
        steps: [d('get_product', { id: 'p-1007' }), d('search_products', { query: 'Hub Pro' })],
      },
      {
        file: 'product-v1.test.ts',
        title: 'v1 product responses still read correctly',
        manifestation: 'v1-preserved',
        steps: [v1('get_product', { id: 'p-1001' }), v1('get_product', { id: 'p-1004' })],
      },
    ],
  },
];
