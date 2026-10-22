// SAST criterion (PLAN 3.0 criterion 4): Semgrep CE (digest-pinned) + eslint-plugin-security + the
// AST detector, 2-of-3 on the diff only. Planted eval( and child_process.exec(input) are flagged;
// nothing new on the D1-D5 oracle patches.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { exportBase, prepareHead } from '../src/head.ts';
import {
  astFindings,
  confirm,
  defaultSastTools,
  eslintFindings,
  type SastFinding,
  sastOnDiff,
} from '../src/sast/index.ts';
import { ORACLES, requireShop, SHOP_DRIFTS, semgrepAvailable } from './support/shop.ts';

const SEARCH = 'src/tools/search_products.ts';
const tmp = mkdtempSync(join(tmpdir(), 'fiks-heldout-sast-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** seed-v1 search_products.ts with a planted line after the handler's opening brace. */
function planted(shop: string, lines: string[], imports: string[] = []): string {
  const base = execFileSync('git', ['show', `seed-v1:${SEARCH}`], { cwd: shop, encoding: 'utf8' });
  return `${imports.join('\n')}${imports.length ? '\n' : ''}${base}`.replace(
    'export async function handler(args: { query: string }, vendor: VendorClient) {\n',
    `export async function handler(args: { query: string }, vendor: VendorClient) {\n${lines.join('\n')}\n`,
  );
}

/** A diff from seed-v1 to `content` at SEARCH, made with git in a scratch clone. */
function diffTo(shop: string, content: string): string {
  const head = prepareHead(shop, 'seed-v1', '', tmp);
  try {
    execFileSync('bash', ['-c', `cat > ${SEARCH}`], { cwd: head.dir, input: content });
    return execFileSync('git', ['diff'], { cwd: head.dir, encoding: 'utf8' });
  } finally {
    head.remove();
  }
}

async function runSast(diff: string, tools = defaultSastTools()) {
  const shop = requireShop();
  const head = prepareHead(shop, 'seed-v1', diff, tmp);
  const base = mkdtempSync(join(tmp, 'base-'));
  try {
    expect(head.applied, head.error).toBe(true);
    exportBase(
      head.dir,
      head.baseCommit,
      [SEARCH, 'src/tools/get_product.ts', 'src/tools/create_order.ts', 'src/tools/get_order.ts'],
      base,
    );
    return await sastOnDiff({ baseDir: base, headDir: head.dir, diff, tools });
  } finally {
    head.remove();
  }
}

describe('detectors (no Docker)', () => {
  const src = `import { exec as run, spawn } from 'node:child_process';
import * as cp from 'child_process';
const { execSync } = require('child_process');
export function h(input: string, q: { query: string }) {
  eval(q.query);
  run(input);
  spawn(input, []);
  cp.execSync(input);
  execSync(\`ls \${input}\`);
  new Function('a', input);
  const ok = eval('1 + 1');
  run('ls -la');
  return ok;
}
`;
  const file = { path: 'src/x.ts', source: src };

  test('AST detector resolves aliases, namespaces and requires; literals are not flagged', () => {
    const f = astFindings(file).map((x) => `${x.line}:${x.category}:${x.rule}`);
    expect(f).toEqual([
      '5:code-eval:eval-nonliteral',
      '6:command-exec:child-process-exec',
      '7:command-exec:child-process-spawn',
      '8:command-exec:child-process-execSync',
      '9:command-exec:child-process-execSync',
      '10:code-eval:function-constructor',
    ]);
  });

  test('eslint-plugin-security reports on original TypeScript lines', () => {
    const f = eslintFindings(file);
    expect(f.some((x) => x.line === 5 && x.category === 'code-eval')).toBe(true);
    expect(f.some((x) => x.line === 6 && x.category === 'command-exec')).toBe(true);
    expect(f.some((x) => x.line === 11)).toBe(false); // eval of a literal
  });

  test('confirm(): >= 2 distinct tools, same file and category, within 2 lines', () => {
    const f = (tool: SastFinding['tool'], line: number, category: SastFinding['category'] = 'code-eval') => ({
      tool,
      rule: 'r',
      category,
      file: 'a.ts',
      line,
    });
    expect(confirm([f('ast', 5), f('eslint-security', 5)])).toHaveLength(1);
    expect(confirm([f('ast', 5), f('ast', 6)])).toHaveLength(0);
    expect(confirm([f('ast', 5), f('semgrep', 9)])).toHaveLength(0);
    expect(confirm([f('ast', 5), f('semgrep', 6, 'command-exec')])).toHaveLength(0);
    expect(confirm([f('ast', 5), f('semgrep', 7), f('eslint-security', 5)])[0]?.tools).toEqual([
      'ast',
      'eslint-security',
      'semgrep',
    ]);
  });
});

describe.runIf(semgrepAvailable())('2-of-3 on the diff (Semgrep CE in Docker)', () => {
  test('planted eval( is a confirmed new finding', async () => {
    const shop = requireShop();
    const r = await runSast(diffTo(shop, planted(shop, ['  eval(args.query);'])));
    expect(r.pass).toBe(false);
    expect(r.confirmed.map((c) => [c.category, c.tools.length >= 2])).toEqual([['code-eval', true]]);
    expect(new Set(r.confirmed[0]?.tools)).toEqual(new Set(['ast', 'eslint-security', 'semgrep']));
  }, 180_000);

  test('planted child_process.exec(input) is a confirmed new finding', async () => {
    const shop = requireShop();
    const r = await runSast(
      diffTo(
        shop,
        planted(
          shop,
          ['  const input = args.query;', '  exec(input);'],
          ["import { exec } from 'node:child_process';"],
        ),
      ),
    );
    expect(r.pass).toBe(false);
    expect(r.confirmed.map((c) => c.category)).toEqual(['command-exec']);
    expect(new Set(r.confirmed[0]?.tools)).toEqual(new Set(['ast', 'eslint-security', 'semgrep']));
  }, 180_000);

  test('a finding the base already has on the same line is not new', async () => {
    const shop = requireShop();
    const r = await runSast(
      diffTo(shop, planted(shop, ['  const re = new RegExp(args.query);', '  void re;'])),
    );
    // New and confirmed (regexp-nonliteral is reported by all three).
    expect(r.confirmed.map((c) => c.category)).toEqual(['regexp-nonliteral']);
  }, 180_000);

  for (const d of SHOP_DRIFTS) {
    test(`oracle ${d}.patch: nothing new`, async () => {
      const r = await runSast(readFileSync(join(ORACLES, `${d}.patch`), 'utf8'));
      expect(r.confirmed).toEqual([]);
      expect(r.pass).toBe(true);
      expect(r.files.length).toBeGreaterThan(0);
    }, 180_000);
  }
});
