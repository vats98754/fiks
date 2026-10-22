// check-no-bounds (PLAN 5.2 item 2): fails on a planted brief with '$2,000' and on a planted docs
// line 'price is between 20 and 2000 USD'; passes on the real briefs, shop.md and the tracker docs;
// prints the sha256 values for the F2 ledger.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { allBriefFiles, briefPath } from '../src/briefs.ts';
import { sha256 } from '../src/export.ts';
import {
  catalogNumeralProblems,
  checkNoBounds,
  constrainedFields,
  proseBoundProblems,
} from '../src/nobounds.ts';
import { fiks, ROOT } from './support/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'blind-nb-'));

describe('check-no-bounds', () => {
  test('passes on the real briefs and both domains docs, and prints every sha256', () => {
    const r = fiks(['author', '--check-no-bounds']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/check-no-bounds: PASS/);
    for (const f of allBriefFiles()) {
      expect(r.out).toContain(`brief ${f.slice(ROOT.length + 1)} ${sha256(readFileSync(f))}`);
    }
    for (const f of [
      'packages/vendor-api/docs/shop.md',
      'packages/vendor-api/openapi.json',
      'packages/vendor-tracker/docs/tracker.md',
      'packages/vendor-tracker/docs/openapi.json',
    ])
      expect(r.out).toContain(`${f} ${sha256(readFileSync(join(ROOT, f)))}`);
    expect(r.out).toMatch(/docs-set:shop [0-9a-f]{64}/);
    expect(r.out).toMatch(/docs-set:tracker [0-9a-f]{64}/);
    expect(r.out).toMatch(/briefs-set [0-9a-f]{64}/);
  });

  test("fails on a planted catalog brief containing '$2,000'", () => {
    const d = tmp();
    const planted = join(d, 'catalog-shop.md');
    writeFileSync(
      planted,
      `${readFileSync(briefPath('catalog-shop'), 'utf8')}\nKeep every price under $2,000.\n`,
    );
    const r = fiks(['author', '--check-no-bounds', '--brief', planted]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/check-no-bounds: FAIL/);
    expect(r.out).toMatch(/numeral 2,000/);
    // The same text in the real brief file name, checked directly:
    expect(
      catalogNumeralProblems('catalog-shop.md', 'Write exactly 25 products under $2,000.').map(
        (p) => p.reason,
      ),
    ).toEqual(['numeral 2,000 (only 25 is allowed)']);
  });

  test("fails on a planted docs line 'price is between 20 and 2000 USD'", () => {
    const d = tmp();
    const planted = join(d, 'shop.md');
    copyFileSync(join(ROOT, 'packages/vendor-api/docs/shop.md'), planted);
    writeFileSync(planted, `${readFileSync(planted, 'utf8')}\nThe price is between 20 and 2000 USD.\n`);
    const r = fiks(['author', '--check-no-bounds', '--docs', planted]);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/numeric bound on constrained field "price"/);
    expect(r.out).toContain('The price is between 20 and 2000 USD.');
  });

  test('constrained fields come from the frozen contracts; other bound forms are caught', () => {
    const shop = JSON.parse(
      readFileSync(join(ROOT, 'packages/contracts/contracts/shop-mcp.contracts.json'), 'utf8'),
    );
    const fields = constrainedFields([shop]);
    expect([...fields]).toEqual(expect.arrayContaining(['price', 'total', 'items', 'created_at']));
    const bad = [
      '`price` must be at most 2000.',
      'Orders older than 30 days are archived (`created_at`).',
      'A total of $5 or more.',
      'price: 20–2000',
      'The price never exceeds 5000.',
    ];
    for (const line of bad) expect(proseBoundProblems('x.md', line, fields), line).toHaveLength(1);
    const fine = [
      'Timestamps are ISO-8601 strings, for example `2026-01-01T09:30:00.000Z` (`created_at`).',
      'An unknown id returns `404` with an error body (`items`).',
      '| `price` | number or null | Unit price, in `currency`. |',
    ];
    for (const line of fine) expect(proseBoundProblems('x.md', line, fields), line).toEqual([]);
  });

  test('an OpenAPI response schema with a bound on a constrained field fails; request-only schemas do not count', () => {
    const doc = JSON.parse(readFileSync(join(ROOT, 'packages/vendor-api/openapi.json'), 'utf8'));
    const d = tmp();
    const f = join(d, 'openapi.json');
    doc.components.schemas.Product.properties.price.maximum = 2000;
    writeFileSync(f, JSON.stringify(doc));
    const r = checkNoBounds({ extraDocs: [f] });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.reason)).toContain('schema bound on constrained field "price"');
    // OrderRequest.items has minItems: 1 but is a request body: the real document passes.
    expect(checkNoBounds().ok).toBe(true);
  });
});
