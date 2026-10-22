// Differential inputs (PLAN 3.0 criterion 2): 200 inputs per drift from the package's generator
// modules, drawn with fast-check under a fixed seed, so every head of a drift (patch, ref A, ref B)
// replays the same inputs in the same order. A generator module exports either
//   arbitrary(fc) -> fast-check Arbitrary of an input           (HOLD packages), or
//   generate(seed, n) -> inputs                                  (DOM2's TRK-DEV-1 form).
// An input is a call sequence; a `{ $ref: { call, field } }` argument is replaced at replay time by
// that field of the named earlier call's structured output (e.g. the id an order call returned).
import { pathToFileURL } from 'node:url';
import * as fc from 'fast-check';
import { canonicalJson, sha256 } from './hash.ts';

/** fast-check 4.10.2 (pinned in package.json); the version is part of the inputs' identity. */
export const FAST_CHECK_VERSION = fc.__version;

/** The pre-registered differential size and seed (PLAN 3.0: "200 fast-check inputs (fixed seed)"). */
export const DIFFERENTIAL_RUNS = 200;
export const DIFFERENTIAL_SEED = 20261021;

export interface InputCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface DiffInput {
  calls: InputCall[];
}

interface GeneratorModule {
  arbitrary?: (f: typeof fc) => fc.Arbitrary<unknown>;
  generate?: (seed: number, n: number) => unknown[];
}

/** `{tool, args}` or `{calls: [...]}` -> a call sequence. */
export function asInput(x: unknown): DiffInput {
  const o = x as { calls?: unknown; tool?: unknown; args?: unknown };
  if (Array.isArray(o?.calls)) return { calls: o.calls as InputCall[] };
  if (typeof o?.tool === 'string')
    return { calls: [{ tool: o.tool, args: (o.args ?? {}) as Record<string, unknown> }] };
  throw new Error(`generator produced a value that is not an input: ${JSON.stringify(x)}`);
}

/**
 * `n` inputs over all generator modules: with several modules, input i comes from module
 * i mod k, each module sampled with the same seed.
 */
export async function drawInputs(
  modules: readonly string[],
  opts: { seed?: number; n?: number } = {},
): Promise<DiffInput[]> {
  const seed = opts.seed ?? DIFFERENTIAL_SEED;
  const n = opts.n ?? DIFFERENTIAL_RUNS;
  if (modules.length === 0) return [];
  const per = modules.map((_, k) => Math.ceil((n - k) / modules.length));
  const drawn: DiffInput[][] = [];
  for (const [k, file] of modules.entries()) {
    const mod = (await import(pathToFileURL(file).href)) as GeneratorModule;
    const count = per[k] ?? 0;
    if (typeof mod.arbitrary === 'function') {
      drawn.push(fc.sample(mod.arbitrary(fc), { seed, numRuns: count }).map(asInput));
    } else if (typeof mod.generate === 'function') {
      drawn.push(mod.generate(seed, count).map(asInput));
    } else {
      throw new Error(`${file}: a generator module exports arbitrary(fc) or generate(seed, n)`);
    }
  }
  const out: DiffInput[] = [];
  for (let i = 0; i < n; i++) {
    const k = i % modules.length;
    const x = drawn[k]?.[Math.floor(i / modules.length)];
    if (x) out.push(x);
  }
  return out;
}

export const inputsHash = (inputs: readonly DiffInput[]) => sha256(canonicalJson(inputs));

/** Replaces `{ $ref: { call, field } }` args with the field of an earlier call's structured output. */
export function resolveArgs(
  args: Record<string, unknown>,
  earlier: readonly unknown[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const ref = (v as { $ref?: { call: number; field: string } } | null)?.$ref;
    if (ref && typeof ref.call === 'number') {
      const prev = earlier[ref.call] as { structuredContent?: Record<string, unknown> } | undefined;
      out[k] = prev?.structuredContent?.[ref.field] ?? null;
    } else out[k] = v;
  }
  return out;
}
