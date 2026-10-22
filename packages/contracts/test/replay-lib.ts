// Helpers for replaying logged CallRecords through an evaluator (offline, `now` = the record's
// own evaluation instant). Used by replay-logged.ts and the vocabulary tests.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { evaluate as Evaluate } from '../src/evaluate.ts';
import type { ContractFile, EvalInput, HttpExchange, JsonSchema, ToolResultLike } from '../src/types.ts';

/** A proxy CallRecord as written to bench/results/<run>/proxy/*.jsonl (fields replay needs). */
export interface LoggedCall {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResultLike;
  http: HttpExchange[];
  probe?: { tool: string; args: Record<string, unknown>; result: ToolResultLike; http: HttpExchange[] };
  at: string;
  receipt?: { verdict: string; checked: string[]; violations: { propertyId: string; path: string }[] };
}

/** The EvalInput the proxy built for this record (a tap was present: upstream is known). */
export function inputOf(rec: LoggedCall, declaredOutputSchema?: JsonSchema): EvalInput {
  return {
    args: rec.args,
    result: rec.result,
    now: new Date(rec.at),
    ...(declaredOutputSchema ? { declaredOutputSchema } : {}),
    ...(rec.probe ? { probe: { ...rec.probe, upstream: rec.probe.http } } : {}),
    upstream: rec.http,
  };
}

export interface Evaluator {
  evaluate: typeof Evaluate;
  contracts: ContractFile;
  source: string;
}

/**
 * The evaluator and contracts vendored into shop-mcp at `ref` (`git show`, no checkout), loaded
 * from a temp copy. `evaluate.ts` imports only types from `./types.ts`.
 */
export async function vendoredEvaluator(shopDir: string, ref: string): Promise<Evaluator> {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-vendored-'));
  for (const f of ['evaluate.ts', 'types.ts', 'shop-mcp.contracts.json']) {
    const body = execFileSync('git', ['show', `${ref}:test/fiks/vendored/${f}`], {
      cwd: shopDir,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    writeFileSync(join(dir, f), body);
  }
  const mod = (await import(pathToFileURL(join(dir, 'evaluate.ts')).href)) as { evaluate: typeof Evaluate };
  const contracts = (
    (await import(pathToFileURL(join(dir, 'shop-mcp.contracts.json')).href, { with: { type: 'json' } })) as {
      default: ContractFile;
    }
  ).default;
  return { evaluate: mod.evaluate, contracts, source: `shop-mcp ${ref}:test/fiks/vendored` };
}

/** The evaluator as it was in the fiks repo at `ref` (e.g. ec241bc), loaded from a temp copy. */
export async function fiksEvaluator(fiksRoot: string, ref: string): Promise<Evaluator> {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-evaluator-'));
  for (const f of ['src/evaluate.ts', 'src/types.ts', 'contracts/shop-mcp.contracts.json']) {
    const body = execFileSync('git', ['show', `${ref}:packages/contracts/${f}`], {
      cwd: fiksRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    writeFileSync(join(dir, f.split('/').pop() as string), body);
  }
  const mod = (await import(pathToFileURL(join(dir, 'evaluate.ts')).href)) as { evaluate: typeof Evaluate };
  const contracts = (
    (await import(pathToFileURL(join(dir, 'shop-mcp.contracts.json')).href, { with: { type: 'json' } })) as {
      default: ContractFile;
    }
  ).default;
  return { evaluate: mod.evaluate, contracts, source: `fiks ${ref}:packages/contracts` };
}
