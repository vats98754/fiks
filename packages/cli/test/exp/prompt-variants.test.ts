// E-A prompt variants (paper/EXP-PLAN.md): NOHINT = the pilot prompt minus exactly four items;
// ALERT = receipt text + violated properties + raw trace, no repro test. The product prompt itself
// must be byte-identical to the committed golden (it is not changed by the variants).
import { readFileSync, writeFileSync } from 'node:fs';
import { findContract, SHOP_CONTRACTS } from '@fiks/contracts';
import { buildPrompt, type PromptInput } from '@fiks/repair';
import type { Trace } from '@fiks/repro';
import { describe, expect, test } from 'vitest';
import { pilotTrace } from '../../src/exp/drifts.ts';
import {
  buildAlertPrompt,
  buildNoHintPrompt,
  NOHINT_OMISSIONS,
  noHintPromptWithOmissions,
  renderExchanges,
} from '../../src/exp/prompts.ts';
import { receiptOf } from '../../src/exp/repair-run.ts';
import { DRIFTS, type ExpDrift } from '../../src/exp/types.ts';

const GOLDEN = new URL('./fixtures/prompt-fiks-D2.txt', import.meta.url).pathname;
const seed = process.env.FIKS_SEED_DIR as string;

function input(drift: ExpDrift, worktree = seed): PromptInput {
  const trace = pilotTrace(drift).trace as Trace;
  const propertyIds = trace.target ?? trace.violated.map((v) => v.propertyId);
  const contract = findContract(SHOP_CONTRACTS, trace.tool);
  if (!contract) throw new Error('no contract');
  const testPath = `test/repro/${trace.id}.test.ts`;
  return {
    trace,
    contract,
    worktree,
    spec: { traceId: trace.id, propertyIds, testPath, tracePath: `test/repro/${trace.id}.json` },
    gateF: {
      gate: 'F',
      ok: true,
      reason: 'fails for the stated reason on 3/3 runs',
      evidence: {
        command: 'vitest run',
        exitCode: 1,
        failed: [
          {
            file: testPath,
            test: '',
            message: `AssertionError: ${propertyIds.join(', ')} violated (test/repro/${trace.id}.json): expected [ Array(1) ] to deeply equal []`,
          },
        ],
        logPath: '',
      },
    },
  };
}

describe('the product prompt is unchanged', () => {
  test('buildPrompt(D2) equals the golden captured from fiks main', () => {
    const p = buildPrompt(input('D2'));
    if (process.env.FIKS_UPDATE_GOLDEN === '1') writeFileSync(GOLDEN, p);
    expect(p).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

describe('NOHINT = buildPrompt minus exactly the four EXP-PLAN items', () => {
  for (const d of DRIFTS) {
    test(`${d}: the four spans, and nothing else, are removed`, () => {
      const inp = input(d);
      const full = buildPrompt(inp);
      const { prompt, removed } = noHintPromptWithOmissions(inp);
      expect(prompt).toBe(buildNoHintPrompt(inp));
      // Every D1-D5 call has a v1 recording, so all four items are present and removed.
      expect(Object.keys(removed).sort()).toEqual([...NOHINT_OMISSIONS].sort());
      // Putting the removed spans back, in order, gives the product prompt again.
      let rebuilt = full;
      for (const span of Object.values(removed)) {
        expect(full.split(span as string)).toHaveLength(2);
        rebuilt = rebuilt.replace(span as string, '');
      }
      expect(rebuilt).toBe(prompt);
      expect(full.length - prompt.length).toBe(
        Object.values(removed).reduce((n, s) => n + (s as string).length, 0),
      );
      // The omissions, shown exactly.
      expect(removed['failure-class sentence']).toBe(
        ' The vendor changed its behavior without changing its published spec, and shop-mcp now returns wrong data to agents without any error.',
      );
      expect(removed['v1-recording path']).toMatch(
        /^- test\/fixtures\/v1\/[\w-]+\.json: a recording of the same call against the previous vendor version \(2026-01-01\), which shop-mcp still has to support\.\n$/,
      );
      expect(removed['vendor-version-header note']).toBe(
        '- Responses carry a vendor-api-version header (2026-01-01 before the change, 2026-10-01 after).\n',
      );
      expect(removed['new-header-extra-pages note']).toContain('(a new header, extra pages)');
      // Contract, trace and repro test stay.
      expect(prompt).toContain(JSON.stringify(inp.contract, null, 2));
      expect(prompt).toContain(renderExchanges(inp.trace));
      expect(prompt).toContain(
        `${inp.spec.testPath} replays that exact call against the recording and fails:`,
      );
      expect(prompt).toContain(inp.gateF.evidence.failed[0]?.message as string);
      for (const hint of [
        'published spec, and',
        'vendor-api-version header (',
        'extra pages',
        'a recording of the same call',
      ])
        expect(prompt).not.toContain(hint);
    });
  }

  test('without a v1 recording of the same call, the generic fixtures line stays', () => {
    const inp = input('D2', '/nonexistent-worktree');
    const { prompt, removed } = noHintPromptWithOmissions(inp);
    expect(removed['v1-recording path']).toBeUndefined();
    expect(prompt).toContain('- test/fixtures/v1/*.json: recordings against the previous vendor version');
  });

  test('the strict trace format is refused (the variants are raw-format only)', () => {
    const inp = input('D2');
    expect(() => buildNoHintPrompt({ ...inp, traceFormat: 'strict' })).toThrow(/raw trace format/);
  });
});

describe('ALERT = receipt text + violated properties + raw trace, no repro test', () => {
  for (const d of DRIFTS) {
    test(`${d}: alert content, and no test, contract or hint`, () => {
      const inp = input(d);
      const trace = inp.trace;
      const receipt = receiptOf(trace);
      const p = buildAlertPrompt({ trace, receiptText: receipt });
      expect(receipt).toMatch(/^\[fiks\] VIOLATED /);
      expect(p).toContain(receipt);
      for (const id of inp.spec.propertyIds) expect(p).toContain(`- ${id}: `);
      expect(p).toContain(`Tool call: ${trace.tool}(${JSON.stringify(trace.args)})`);
      // The raw trace block is exactly the product prompt's.
      expect(p).toContain(renderExchanges(trace));
      expect(buildPrompt(inp)).toContain(renderExchanges(trace));
      // No repro test (not shown, not mentioned), no contract.
      for (const word of [
        /repro/i,
        /reproduction/i,
        /test\/repro/,
        /UNMATCHED_REQUEST/,
        /re-record/,
        /contract for/i,
      ])
        expect(p).not.toMatch(word);
      expect(p).not.toContain(inp.spec.testPath);
      expect(p).not.toContain(JSON.stringify(inp.contract, null, 2));
      // None of the NOHINT omissions.
      const { removed } = noHintPromptWithOmissions(inp);
      for (const span of Object.values(removed)) expect(p).not.toContain((span as string).trim());
    });
  }
});
