import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractFile } from '@fiks/contracts';
import { SHOP_CONTRACTS } from '@fiks/contracts';
import { describe, expect, it } from 'vitest';
import {
  acceptDelta,
  CONTRACT_UPDATE_OUTCOME_SCHEMA,
  type ContractDelta,
  contractDiff,
  parseOutcome,
  renderProposal,
} from '../src/index.ts';
import { cleanCorpus, premiumSearch, searchVariants, shopOutputSchemas, storedTraces } from './helpers.ts';

const widen = (max: number): ContractDelta => ({
  rationale: 'Vendor changelog 2026-10: premium laptops above $2,000 are now sold.',
  ops: [
    {
      op: 'replaceInvariant',
      contractId: 'shop.search_products',
      invariant: {
        id: 'items.price.range',
        kind: 'range',
        path: 'items[*].price',
        min: 20,
        max,
        unit: 'USD',
      },
    },
  ],
});

const gate = (delta: ContractDelta) =>
  acceptDelta(delta, {
    contracts: SHOP_CONTRACTS,
    trigger: premiumSearch(),
    storedViolations: storedTraces(),
    cleanCorpus: cleanCorpus(),
    mutationVariants: searchVariants(),
    declaredOutputSchemas: shopOutputSchemas(),
  });

describe('renderProposal', () => {
  it('renders an accepted delta as a contract diff only', () => {
    const p = renderProposal(SHOP_CONTRACTS, gate(widen(3000)));
    expect(p.diff).toBe(
      [
        '--- a/contracts/shop-mcp.contracts.json (contract shop.search_products)',
        '+++ b/contracts/shop-mcp.contracts.json (contract shop.search_products)',
        '@@ -7,7 +7,7 @@',
        '       "kind": "range",',
        '       "path": "items[*].price",',
        '       "min": 20,',
        '-      "max": 2000,',
        '+      "max": 3000,',
        '       "unit": "USD"',
        '     },',
        '     {',
        '',
      ].join('\n'),
    );
    expect(p.markdown).toContain('# Contract update proposal');
    expect(p.markdown).toContain('Vendor changelog 2026-10');
    expect(p.markdown).toContain('`shop.search_products/items.price.range`');
    expect(p.markdown).toContain('5 of 5 still violate');
    expect(p.markdown).toContain(p.diff.trimEnd());
    // Never code: no source path, no code fence other than the contract diff.
    expect(p.markdown).not.toMatch(/\.(ts|js|mjs|py)\b/);
    expect(p.markdown.match(/```/g)).toHaveLength(2);
    expect(p.proposed.contracts.find((c) => c.id === 'shop.search_products')?.invariants[0]).toMatchObject({
      max: 3000,
    });
  });

  it('refuses a rejected delta and a non-contract path', () => {
    expect(() => renderProposal(SHOP_CONTRACTS, gate(widen(200_000)))).toThrow(/only an accepted/);
    expect(() =>
      renderProposal(SHOP_CONTRACTS, gate(widen(3000)), { contractsPath: 'src/server.ts' }),
    ).toThrow(/never touches code/);
  });
});

describe('contractDiff', () => {
  it('matches diff -U3 hunk for hunk on a multi-hunk change', () => {
    const next = structuredClone(SHOP_CONTRACTS) as ContractFile;
    const c = next.contracts.find((x) => x.id === 'shop.get_product');
    if (!c?.knownGoodInputs) throw new Error('fixture');
    c.invariants[0] = { id: 'price.notNull', kind: 'notNull', path: 'price' };
    c.knownGoodInputs = c.knownGoodInputs.filter((x) => x.id !== 'p-1106');
    const ours = contractDiff(SHOP_CONTRACTS, next, 'c.contracts.json').split('\n').slice(2).join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'cu-diff-'));
    const pretty = (f: ContractFile) => `${JSON.stringify(f.contracts[1], null, 2)}\n`;
    writeFileSync(join(dir, 'a'), pretty(SHOP_CONTRACTS));
    writeFileSync(join(dir, 'b'), pretty(next));
    let theirs = '';
    try {
      execFileSync('diff', ['-U3', join(dir, 'a'), join(dir, 'b')], { encoding: 'utf8' });
    } catch (e) {
      theirs = (e as { stdout: string }).stdout.split('\n').slice(2).join('\n');
    }
    expect(ours.match(/^@@/gm)).toHaveLength(2);
    expect(ours).toBe(theirs);
  });
});

describe('parseOutcome', () => {
  it('parses the outcome from an object or JSON text', () => {
    const o = { outcome: 'contract_update', delta: widen(3000) };
    expect(parseOutcome(o)).toEqual({ ok: true, value: o });
    expect(parseOutcome(JSON.stringify(o))).toEqual({ ok: true, value: o });
  });

  it('rejects other outcomes, extra fields and bad deltas with every error listed', () => {
    const r = parseOutcome({ outcome: 'code_fix', delta: { ops: [{ op: 'nope' }] }, extra: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'outcome: unknown field "extra"',
      'outcome.outcome: must be "contract_update"',
      'delta.rationale: must be a non-empty string',
      'delta.ops[0].contractId: must be a non-empty string',
      expect.stringMatching(/^delta\.ops\[0\]\.op: must be one of replaceInvariant/),
    ]);
    expect(parseOutcome('not json')).toMatchObject({ ok: false });
  });

  it('publishes a JSON Schema whose op list matches the parser', () => {
    const ops = (CONTRACT_UPDATE_OUTCOME_SCHEMA as { properties: Record<string, unknown> }).properties;
    expect(JSON.stringify(ops)).toContain('replaceInvariant');
    expect(JSON.stringify(ops)).not.toContain('remove"'); // no remove op
    for (const op of [
      'replaceInvariant',
      'addInvariant',
      'replacePostcondition',
      'setOutputSchema',
      'addKnownGoodInput',
      'removeKnownGoodInput',
    ]) {
      const r = parseOutcome({
        outcome: 'contract_update',
        delta: { rationale: 'x', ops: [{ op, contractId: 'c' }] },
      });
      // Each listed op is known to the parser: errors are about its payload, never its name.
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).not.toMatch(/\.op: must be one of/);
    }
  });
});
