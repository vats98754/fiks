import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../lib/git.ts';
import { CANONICAL, checkLedger, loadLedgerSchema } from '../lib/ledger.ts';
import { CASES, runCases } from '../lib/ledger-selftest.ts';
import { validate } from '../lib/mini-schema.ts';

const ledgerPath = new URL('../freeze-ledger.json', import.meta.url);

describe('freeze-ledger.json', () => {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

  it('is the empty ledger: F1-F10 incl. F4b, canonical tags, nothing recorded', () => {
    expect(validate(ledger, loadLedgerSchema())).toEqual([]);
    expect(ledger.freezes.map((f: { id: string }) => f.id)).toEqual(CANONICAL.map((c) => c.id));
    expect(ledger.freezes.map((f: { tag: string }) => f.tag)).toEqual(CANONICAL.map((c) => c.tag));
    expect(ledger.freezes.every((f: { record: unknown }) => f.record === null)).toBe(true);
  });

  it('F2 carries slots for both domains docs, all seven briefs, the no-bound check and the authorship note', () => {
    const f2 = ledger.freezes.find((f: { id: string }) => f.id === 'F2');
    expect(f2.details.docs.shop.map((d: { path: string }) => d.path)).toEqual([
      'packages/vendor-api/openapi.json',
      'packages/vendor-api/docs/shop.md',
    ]);
    expect(f2.details.docs.tracker).toHaveLength(2);
    expect(f2.details.briefs.map((b: { kind: string }) => b.kind)).toEqual([
      'catalog',
      'contract-author',
      'drift',
      'evasive',
      'benign',
      'fixer',
      'rater',
    ]);
    expect(f2.details.noBoundCheck.command).toBe('pnpm fiks author --check-no-bounds');
    expect(f2.details.shopDocsAuthorshipNote).toContain('CORE builder');
  });

  it('passes check-ledger on this repository (no freeze tag exists yet)', () => {
    const r = checkLedger(ledger, { repo: repoRoot(new URL('.', import.meta.url).pathname) });
    expect(r.errors).toEqual([]);
  });
});

describe('check-ledger self-test on toy repositories', () => {
  const outcomes = runCases();
  for (const [i, c] of CASES.entries()) {
    it(`${c.expect}s: ${c.name}`, () => {
      const o = outcomes[i];
      expect(o?.got, o?.result.errors.join('\n')).toBe(c.expect);
      expect(o?.ok, o?.result.errors.join('\n')).toBe(true);
    });
  }
});
