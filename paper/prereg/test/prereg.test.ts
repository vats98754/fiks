import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blocksOf, normalize } from '../lib/plan-blocks.ts';
import { checkPrereg, parseConstants } from '../lib/prereg-check.ts';
import { CATEGORIES, NAMED_RULES, SECTIONS } from '../lib/prereg-rules.ts';

const plan = readFileSync(new URL('../../PLAN.md', import.meta.url), 'utf8');
const prereg = readFileSync(new URL('../PREREG.md', import.meta.url), 'utf8');

describe('plan-blocks', () => {
  const md = [
    '## 1. A',
    '',
    'Para line one',
    'continues here.',
    '- item one',
    '  wrapped',
    '  - nested',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '```',
    '## not a heading',
    '```',
    '### 1.1 Sub',
    'text',
    '## 2. B',
    'outside',
  ].join('\n');

  it('splits a section into headings, paragraphs, items, rows and code', () => {
    const bs = blocksOf(md, '1');
    expect(bs.map((b) => [b.kind, b.text])).toEqual([
      ['heading', '1. A'],
      ['para', 'Para line one continues here.'],
      ['item', '- item one wrapped'],
      ['item', '- nested'],
      ['row', '| a | b |'],
      ['row', '| 1 | 2 |'],
      ['code', '``` ## not a heading ```'],
      ['heading', '1.1 Sub'],
      ['para', 'text'],
    ]);
    expect(blocksOf(md, '1.1').map((b) => b.text)).toEqual(['1.1 Sub', 'text']);
  });

  it('normalises only whitespace', () => {
    expect(normalize('  a \n\t b  ')).toBe('a b');
  });
});

describe('check-prereg on the real PLAN.md and PREREG.md', () => {
  const r = checkPrereg(plan, prereg);

  it('passes: every block of PLAN 3, 4, 5.5, 5.7, 8.2, 9 and 13 is verbatim, in order', () => {
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.blocksBySection).sort()).toEqual([...SECTIONS].sort());
    expect(r.blocksChecked).toBeGreaterThan(400);
  });

  it('finds every named rule class', () => {
    for (const c of CATEGORIES) expect(r.categories[c]?.length, c).toBeGreaterThan(0);
    const found = Object.values(r.categories).reduce((n, ids) => n + ids.length, 0);
    expect(found).toBe(NAMED_RULES.length);
  });

  it('registers every constant PLAN leaves to PREREG, and --final rejects open FILL slots', () => {
    expect(r.constants['seed.signflip.H2']).toBeTypeOf('number');
    expect(r.constants['signflip.flips']).toBe(200000);
    expect(r.fills).toBeGreaterThan(0);
    expect(checkPrereg(plan, prereg, { final: true }).errors.join()).toContain('slots are still open');
  });
});

describe('check-prereg fails on mutations', () => {
  const fails = (text: string, expected: string) => {
    const errs = checkPrereg(plan, text).errors.join('\n');
    expect(errs).toContain(expected);
  };

  it('a deleted short item that also occurs elsewhere is caught by PLAN order', () => {
    // "load without error;" is an F-check item of 5.5; delete its Part II copy only.
    const idx = prereg.lastIndexOf('  - load without error;');
    expect(idx).toBeGreaterThan(0);
    fails(`${prereg.slice(0, idx)}${prereg.slice(idx + '  - load without error;'.length)}`, 'line');
  });

  it('a changed H1 test, N_E step, IV rule, E4 row or infra rule fails', () => {
    fails(
      prereg.replace('reject iff X ≤ crit(N_E, 0.02, α)', 'reject iff X < crit(N_E, 0.02, α)'),
      'test / H1',
    );
    fails(
      prereg.replace('If N_E < 217: H1 is descriptive only', 'If N_E < 200: H1 is descriptive only'),
      'N_E rule / step3',
    );
    fails(
      prereg.replace('IV is pre-PR in L1 (a gate)', 'IV is post-PR in L1 (a gate)'),
      'IV definition / placement',
    );
    fails(
      prereg.replace('| E4 | Benign evolution (X21, SYN H18) |', '| E4 | Benign evolution |'),
      'E4/E7 analysis rule / E4',
    );
    fails(prereg.replace('It is re-queued ≤ 2 times.', 'It is re-queued ≤ 3 times.'), 'infra rule / requeue');
  });

  it('a missing constants block or a duplicate seed fails', () => {
    expect(parseConstants('no block').errors.join()).toContain('exactly one');
    const dup = prereg.replace('seed.signflip.H3a = 2026102102', 'seed.signflip.H3a = 2026102101');
    fails(dup, 'seeds are not distinct');
  });
});
