import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, findContract, SHOP_CONTRACTS } from '@fiks/contracts';
import { describe, expect, test } from 'vitest';
import {
  createJudgeMonitor,
  createLlmcMonitor,
  type LlmFn,
  type LlmRequest,
  llmcContractPath,
  loadLlmcMonitors,
  parseContractFile,
  parseJudge,
  promptHashes,
  renderJudgePrompt,
  runDetector,
  UPSTREAM_BODY_CAP,
  variantPromptHash,
} from '../src/index.ts';
import { bench, find, input, ROOT, TOOL_DEFS } from './helpers.ts';

const { v1, v2 } = bench();

/** A deterministic stub: answers by a hash of the prompt, in a few output styles, with usage. */
function stubLlm(calls: LlmRequest[]): LlmFn {
  return async (req) => {
    calls.push(req);
    const n = calls.length;
    const verdicts = ['verified', 'violated', 'unverifiable'] as const;
    const answer = {
      verdict: verdicts[n % 3],
      property: n % 3 === 1 ? 'price.unit' : null,
      confidence: (n % 10) / 10,
    };
    const styles = [
      JSON.stringify(answer),
      `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
      `Here you go: ${JSON.stringify(answer)}`,
    ];
    return {
      text: styles[n % 3] as string,
      tokens: { in: 1000 + n, out: 20, cacheRead: 5 },
      costUsd: 0.001 * n,
    };
  };
}

describe('B-JUDGE / B-JUDGE+U', () => {
  test('prompt files match their recorded hashes', () => {
    const recorded = JSON.parse(readFileSync(join(ROOT, 'packages/baselines/prompts/HASHES.json'), 'utf8'));
    expect(recorded.files).toEqual(promptHashes());
    expect(recorded.variants).toEqual({
      'B-JUDGE': variantPromptHash('B-JUDGE'),
      'B-JUDGE+U': variantPromptHash('B-JUDGE+U'),
    });
  });

  test('with a stub llm, every row parses and carries tokens and costUsd', async () => {
    const records = [...v1, ...v2];
    for (const variant of ['B-JUDGE', 'B-JUDGE+U'] as const) {
      const calls: LlmRequest[] = [];
      const m = createJudgeMonitor({ variant, model: 'claude-haiku-5-5', llm: stubLlm(calls) });
      const detected = await runDetector(m, records, { toolDefs: TOOL_DEFS });
      expect(detected).toHaveLength(records.length);
      expect(calls).toHaveLength(records.length);
      expect(detected.every((d) => (d.result as { parsed?: boolean }).parsed === true)).toBe(true);
      for (const { row } of detected) {
        expect(row.detector).toBe(`${variant}:claude-haiku-5-5`);
        expect(typeof row.tokens).toBe('number');
        expect(typeof row.costUsd).toBe('number');
        expect(row.confidence === null || typeof row.confidence === 'number').toBe(true);
      }
      expect(new Set(detected.map((d) => d.row.verdict))).toEqual(
        new Set(['verified', 'violated', 'unverifiable']),
      );
      expect(detected.find((d) => d.row.verdict === 'violated')?.row.property).toBe(`${variant}/price.unit`);
      expect(calls.every((c) => c.model === 'claude-haiku-5-5' && c.schema !== undefined)).toBe(true);
    }
  });

  test('only B-JUDGE+U sees the upstream body; long bodies are capped', () => {
    const rec = find(v2, (r) => r.drift === 'D2');
    const plain = renderJudgePrompt('B-JUDGE', input(rec));
    const withU = renderJudgePrompt('B-JUDGE+U', input(rec));
    expect(plain.prompt).not.toContain('unit_amount');
    expect(withU.prompt).toContain('"unit_amount":1199');
    expect(withU.prompt).toContain('GET /products/p-1001');
    expect(plain.prompt).toContain('Description: Get one product by id');
    expect(plain.system).not.toContain('<!--');
    const big = input(rec);
    const first = big.upstream?.[0];
    if (first) first.response.body = 'x'.repeat(UPSTREAM_BODY_CAP + 50);
    expect(renderJudgePrompt('B-JUDGE+U', big).prompt).toContain('[... 50 more bytes]');
  });

  test('parseJudge accepts fenced or prefixed JSON and rejects anything else', () => {
    expect(parseJudge('{"verdict":"violated","property":"x","confidence":0.7}')).toEqual({
      verdict: 'violated',
      property: 'x',
      confidence: 0.7,
    });
    expect(parseJudge('```json\n{"verdict":"verified","property":null,"confidence":1}\n```')?.verdict).toBe(
      'verified',
    );
    expect(parseJudge('{"verdict":"ok"}')).toBeNull();
    expect(parseJudge('not json')).toBeNull();
    expect(parseJudge('{"verdict":"verified","property":null,"confidence":7}')?.confidence).toBeNull();
  });

  test('an unparseable answer is unverifiable with parsed: false, still with usage', async () => {
    const m = createJudgeMonitor({
      variant: 'B-JUDGE',
      model: 'm',
      llm: async () => ({ text: 'I think it is fine', tokens: { in: 1, out: 2 }, costUsd: 0.5 }),
    });
    const r = await m(input(find(v1, () => true)));
    expect(r).toMatchObject({ verdict: 'unverifiable', parsed: false, tokens: 3, costUsd: 0.5 });
  });
});

describe('B-LLMC runner', () => {
  test('with the hand contracts as a stand-in, verdicts equal the logged receipts', async () => {
    const m = createLlmcMonitor({ label: 'shop-hand', contracts: SHOP_CONTRACTS });
    expect(m.id).toBe('B-LLMC:shop-hand');
    for (const rec of [...v1, ...v2]) {
      const receipt = rec.events.find((e) => e.type === 'legacy-bench')?.receipt as {
        verdict: string;
        violations: { propertyId: string }[];
      };
      const r = await m(input(rec));
      expect(r.verdict, rec.callId).toBe(receipt.verdict);
      expect(
        r.violations.map((v) => v.propertyId),
        rec.callId,
      ).toEqual(receipt.violations.map((v) => v.propertyId));
    }
  });

  test('loads every seed file that exists and evaluates with it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fiks-llmc-'));
    const only = {
      ...SHOP_CONTRACTS,
      contracts: SHOP_CONTRACTS.contracts.filter((c) => c.tool === 'get_product'),
    };
    writeFileSync(llmcContractPath('shop', 2, dir), JSON.stringify(only));
    const ms = loadLlmcMonitors('shop', dir);
    expect(ms.map((m) => m.id)).toEqual(['B-LLMC:shop-seed2']);
    expect(ms[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const d2 = find(v2, (r) => r.drift === 'D2');
    const expected = evaluate(findContract(only, 'get_product'), input(d2));
    expect((await ms[0]?.(input(d2)))?.verdict).toBe(expected.verdict);
    expect((await ms[0]?.(input(find(v1, (r) => r.tool === 'get_order'))))?.verdict).toBe('unverifiable');
  });

  test('parseContractFile rejects malformed files', () => {
    expect(() => parseContractFile('{"version":2,"server":"s","contracts":[]}')).toThrow(/version/);
    expect(() => parseContractFile('{"version":1,"server":"s","contracts":[{"id":"x"}]}')).toThrow(
      /invariants/,
    );
    expect(parseContractFile(JSON.stringify(SHOP_CONTRACTS)).contracts).toHaveLength(4);
  });
});
