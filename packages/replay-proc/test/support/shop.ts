// The shop-mcp clone (.work/shop-mcp, from scripts/ensure-shop-mcp.mjs) at pinned refs, extracted
// into throwaway directories with `git archive` (the clone's own worktree and refs are untouched).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractFile, EvalInput, EvalResult, Recording, ToolContract } from '@fiks/contracts';

export const SHOP = new URL('../../../../.work/shop-mcp', import.meta.url).pathname;
/** Unfixed seed (annotated tag). */
export const SEED = 'seed-v1^{commit}';
/** shop-mcp main with the D1-D5 fixes merged; holds the D2 trace tr_079b90c89e. */
export const FIXED = '7bf2e665b3ed38110045fa3026cb14ea764e946d';
export const D2_TRACE = 'test/repro/tr_079b90c89e.json';
export const D2_TARGET = 'shop.get_product/price.notNull';

export function requireShop(): void {
  if (!existsSync(join(SHOP, '.git')) || !existsSync(join(SHOP, 'node_modules'))) {
    throw new Error(`shop-mcp clone missing at ${SHOP}: run \`node scripts/ensure-shop-mcp.mjs\` first`);
  }
}

export interface ShopCheckout {
  dir: string;
  cleanup(): void;
}

/** The tree at `ref`, with the clone's node_modules (same lockfile at seed and main). */
export function extractShop(ref: string): ShopCheckout {
  requireShop();
  const dir = join(mkdtempSync(join(tmpdir(), 'fiks-rbx-shop-')), 'shop');
  execFileSync('mkdir', ['-p', dir]);
  const tar = execFileSync('git', ['-C', SHOP, 'archive', '--format=tar', ref]);
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  symlinkSync(realpathSync(join(SHOP, 'node_modules')), join(dir, 'node_modules'));
  return { dir, cleanup: () => rmSync(join(dir, '..'), { recursive: true, force: true }) };
}

export function readAtRef(ref: string, path: string): string {
  requireShop();
  return execFileSync('git', ['-C', SHOP, 'show', `${ref}:${path}`], { encoding: 'utf8' });
}

export function d2Trace(): Recording {
  return JSON.parse(readAtRef(FIXED, D2_TRACE)) as Recording;
}

export function shopServer(dir: string) {
  return { command: join(dir, 'node_modules/.bin/tsx'), args: ['src/main.ts'], cwd: dir };
}

export function vendoredContracts(dir: string): ContractFile {
  return JSON.parse(
    readFileSync(join(dir, 'test/fiks/vendored/shop-mcp.contracts.json'), 'utf8'),
  ) as ContractFile;
}

type Evaluate = (contract: ToolContract | undefined, input: EvalInput) => EvalResult;

/** The checkout's own vendored evaluator (what its in-process harness uses). */
export async function vendoredEvaluate(dir: string): Promise<Evaluate> {
  const mod = (await import(join(dir, 'test/fiks/vendored/evaluate.ts'))) as { evaluate: Evaluate };
  return mod.evaluate;
}

const INPROC_TEST = `import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { replayRecording } from './run.ts';

test('fiks RBX in-process replay probe', async () => {
  const rec = JSON.parse(readFileSync(process.env.RBX_TRACE as string, 'utf8'));
  const r = await replayRecording(rec);
  writeFileSync(process.env.RBX_OUT as string, JSON.stringify({ evaluation: r.evaluation, unmatched: r.unmatched }));
});
`;

/**
 * Runs the checkout's own in-process harness (test/fiks/run.ts `replayRecording`) on `rec`
 * inside its own vitest, and returns its evaluation.
 */
export function inProcessReplay(
  dir: string,
  rec: Recording,
): { evaluation: EvalResult; unmatched: string[] } {
  const work = mkdtempSync(join(tmpdir(), 'fiks-rbx-inproc-'));
  const trace = join(work, 'trace.json');
  const out = join(work, 'out.json');
  writeFileSync(trace, JSON.stringify(rec));
  const testFile = 'test/fiks/rbx-inproc.test.ts';
  writeFileSync(join(dir, testFile), INPROC_TEST);
  try {
    const r = spawnSync(join(dir, 'node_modules/.bin/vitest'), ['run', testFile, '--reporter=dot'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, RBX_TRACE: trace, RBX_OUT: out, VITEST: undefined, VITEST_WORKER_ID: undefined },
    });
    if (!existsSync(out)) throw new Error(`in-process replay produced no result:\n${r.stdout}\n${r.stderr}`);
    return JSON.parse(readFileSync(out, 'utf8')) as { evaluation: EvalResult; unmatched: string[] };
  } finally {
    rmSync(join(dir, testFile), { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}
