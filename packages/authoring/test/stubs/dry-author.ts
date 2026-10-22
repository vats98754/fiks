// Stub for the dry-run author (tests only). It plays every role of the shop pipeline:
// - ideation (no tools): one idea, "GET /products/{id} renames stock to quantity_available";
// - drift author (cwd has blind/IDEA.md): the rewriter, match, metadata, generators, three hidden
//   tests (+ renamed-id variant) and ref A (an edit of src/tools/get_product.ts);
// - fixer (cwd has blind/DRIFT.md): an independent ref B with a different edit;
// - rater (cwd has DRIFT.md at the root): a structured score.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StubAuthor } from '../../src/stub.ts';

export const TRANSFORM_TS = `// Vendor release: GET /products/{id} reports stock as quantity_available.
interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const transform = {
  description: 'GET /products/{id}: stock is renamed to quantity_available',
  response(_req: unknown, res: Res): Res | undefined {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as Record<string, unknown>;
    if (!('stock' in body)) return undefined;
    const { stock, ...rest } = body;
    return { ...res, body: JSON.stringify({ ...rest, quantity_available: stock }) };
  },
};

export default transform;
`;

const P = {
  'p-1001': { name: 'Aero 14 Laptop', category: 'laptop', price: 1199, stock: 12 },
  'p-1003': { name: 'Titan 16 Laptop', category: 'laptop', price: 1499, stock: 4 },
  'p-1005': { name: 'Clarity 27 Monitor', category: 'monitor', price: 329, stock: 25 },
} as const;

function hiddenTest(title: string, id: keyof typeof P, drifted: boolean, rename?: string): string {
  const p = P[id];
  const pid = rename ?? id;
  const body = drifted
    ? {
        id: pid,
        name: p.name,
        category: p.category,
        price: p.price,
        currency: 'USD',
        quantity_available: p.stock,
      }
    : { id: pid, name: p.name, category: p.category, price: p.price, currency: 'USD', stock: p.stock };
  const expected = {
    id: pid,
    name: p.name,
    category: p.category,
    price: p.price,
    currency: 'USD',
    in_stock: p.stock > 0,
  };
  return `// Hidden test: ${title}
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import * as tools from '../../src/tools/handlers.ts';
import { createVendorClient } from '../../src/vendor.ts';

const BODY = ${JSON.stringify(JSON.stringify(body))};

test(${JSON.stringify(title)}, async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/products/${pid}') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(BODY);
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"not_found","message":"Unknown product."}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = \`http://127.0.0.1:\${(server.address() as AddressInfo).port}\`;
    const result = await tools.getProduct.handler({ id: '${pid}' }, createVendorClient(url));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(${JSON.stringify(expected)});
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
`;
}

const TESTS: [string, string, keyof typeof P, boolean, string][] = [
  [
    'product-in-stock.test.ts',
    'get_product reports an in-stock laptop as in stock',
    'p-1001',
    true,
    'p-9001',
  ],
  [
    'product-low-stock.test.ts',
    'get_product reports a low-stock laptop as in stock',
    'p-1003',
    true,
    'p-9003',
  ],
  ['product-v1-shape.test.ts', 'get_product still reads the previous stock field', 'p-1005', false, 'p-9005'],
];

const GENERATORS = `export default function generate(random: () => number) {
  const ids = ['p-1001', 'p-1002', 'p-1003', 'p-1004', 'p-1005', 'p-1006', 'p-1007', 'p-1008'];
  return Array.from({ length: 6 }, () => ({ tool: 'get_product', args: { id: ids[Math.floor(random() * ids.length)] } }));
}
`;

const author: StubAuthor = (req) => {
  if (req.route === 'complete' || req.route === 'ollama') {
    return {
      structured: {
        ideas: [
          {
            title: 'Stock field renamed',
            description: 'The product resource reports its stock under quantity_available.',
            endpoint: 'GET /products/{id}',
            category: 'Data and schema faults',
            symptom: 'R4',
            plausibleString: false,
          },
        ],
      },
    };
  }
  const src = join(req.cwd, 'src/tools/get_product.ts');
  if (existsSync(join(req.cwd, 'blind/IDEA.md'))) {
    const code = readFileSync(src, 'utf8')
      .replace('  stock: number;\n', '  stock?: number;\n  quantity_available?: number;\n')
      .replace('in_stock: p.stock > 0,', 'in_stock: (p.stock ?? p.quantity_available ?? 0) > 0,');
    const files: Record<string, string> = {
      'blind/out/transform.ts': TRANSFORM_TS,
      'blind/out/match.json': JSON.stringify({ method: 'GET', pathPattern: '^/products/[^/]+$' }),
      'blind/out/drift.json': JSON.stringify({
        title: 'Stock field renamed',
        summary: 'GET /products/{id} returns quantity_available instead of stock.',
        category: 'Data and schema faults',
        symptom: 'R4',
        plausibleString: false,
        changelog: null,
      }),
      'blind/out/generators.ts': GENERATORS,
      'src/tools/get_product.ts': code,
    };
    for (const [file, title, id, drifted, renamed] of TESTS) {
      files[`test/hidden/${file}`] = hiddenTest(title, id, drifted);
      files[`blind/out/hidden-renamed/${file}`] = hiddenTest(title, id, drifted, renamed);
    }
    return {
      // Like a real author: look around in the offline container (the repo image has node_modules).
      toolUses: [
        {
          name: 'Bash',
          input: {
            command:
              "ls node_modules/.bin | grep -c vitest; node -e \"require('dns').lookup('example.com',(e)=>console.log(e?'EGRESS_DENIED '+e.code:'EGRESS_OK'))\"",
          },
        },
      ],
      files,
      text: 'drift, tests and fix written',
    };
  }
  if (existsSync(join(req.cwd, 'blind/DRIFT.md'))) {
    const code = readFileSync(src, 'utf8')
      .replace('  stock: number;\n', '  stock?: number;\n  quantity_available?: number;\n')
      .replace(
        'in_stock: p.stock > 0,',
        "in_stock: (typeof p.stock === 'number' ? p.stock : typeof p.quantity_available === 'number' ? p.quantity_available : 0) > 0,",
      );
    return { files: { 'src/tools/get_product.ts': code }, text: 'fixed' };
  }
  if (existsSync(join(req.cwd, 'DRIFT.md')))
    return { structured: { score: 4, rationale: 'Field renames happen.' } };
  return { text: 'nothing to do' };
};

export default author;
