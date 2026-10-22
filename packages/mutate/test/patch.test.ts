// mutatePatch with a stub llm on each D1-D5 oracle patch (packages/cli/test/oracles, which apply to
// shop-mcp seed-v1): every P1-P8 result must be a diff that `git apply --check` accepts on a
// seed-v1 export. The stub writes replies the way a sloppy model does (wrong hunk counts and
// starts, prose around the fence, CRLF, bare blank lines, trailing whitespace, dropped hunks), so
// the wrapper's repairs are exercised too. Needs .work/shop-mcp (root `pretest` /
// `node scripts/ensure-shop-mcp.mjs`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  baseFilesAt,
  mutatePatch,
  normalizePatch,
  PATCH_OPS,
  type PatchLlm,
  type PatchOp,
  renderPatchPrompt,
} from '../src/index.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHOP = join(ROOT, '.work/shop-mcp');
const ORACLES = join(ROOT, 'packages/cli/test/oracles');
const DRIFTS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
const BASE_REF = 'seed-v1';

/** The reference diff as the prompt carries it. */
function refFromPrompt(prompt: string): string {
  const m = /## Reference fix[^\n]*\n\n```diff\n([\s\S]*?)\n```/.exec(prompt);
  if (!m) throw new Error('stub: no reference diff in the prompt');
  return `${m[1]}\n`;
}

/** Splits a diff into its header lines and hunks (header line + body). */
function hunksOf(diff: string): { head: string[]; hunks: string[][] } {
  const lines = diff.replace(/\n$/, '').split('\n');
  const head: string[] = [];
  const hunks: string[][] = [];
  for (const l of lines) {
    if (l.startsWith('@@')) hunks.push([l]);
    else if (hunks.length) (hunks[hunks.length - 1] as string[]).push(l);
    else head.push(l);
  }
  return { head, hunks };
}

/** Inserts an indented comment line before the first added line of the first hunk. */
function addComment(hunk: string[], text: string): string[] {
  const i = hunk.findIndex((l, k) => k > 0 && l.startsWith('+'));
  const at = i < 0 ? 1 : i;
  const indent = /^[+ -](\s*)/.exec(hunk[at] ?? ' ')?.[1] ?? '';
  return [...hunk.slice(0, at), `+${indent}// ${text}`, ...hunk.slice(at)];
}

const breakHeader = (h: string, shift: number) =>
  h.replace(
    /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
    (_m, a, b) => `@@ -${Number(a) + shift},99 +${Number(b) + shift},1 @@`,
  );

/** A deterministic stand-in for the model: a structurally varied edit of the reference fix. */
const stub: PatchLlm = async ({ op, prompt }) => {
  const { head, hunks } = hunksOf(refFromPrompt(prompt));
  let hs = hunks.map((h) => [...h]);
  const note = `${op}: stub edit`;
  switch (op) {
    case 'P4': // partial fix: keep the first hunk only (when there are several)
      hs = hs.length > 1 ? hs.slice(0, 1) : [addComment(hs[0] as string[], note)];
      break;
    case 'P5': // starts off by 7 lines, counts wrong
      hs = hs
        .map((h, i) => (i === 0 ? addComment(h, note) : h))
        .map((h) => [breakHeader(h[0] as string, 7), ...h.slice(1)]);
      break;
    case 'P3': // trailing whitespace on context lines; bare blank context lines
      hs = hs.map((h, i) =>
        (i === 0 ? addComment(h, note) : h).map((l, k) =>
          k > 0 && l.startsWith(' ') ? (l.trim() ? `${l}  ` : '') : l,
        ),
      );
      break;
    default:
      hs = hs
        .map((h, i) => (i === 0 ? addComment(h, note) : h))
        .map((h) => [breakHeader(h[0] as string, 0), ...h.slice(1)]);
  }
  const diff = [...head.filter((l) => !l.startsWith('index ')), ...hs.flat()].join('\n');
  if (op === 'P7')
    return `Here is the patch.\r\n\r\n\`\`\`diff\r\n${diff.replace(/\n/g, '\r\n')}\r\n\`\`\`\r\nDone.`;
  return `\`\`\`diff\n${diff}\n\`\`\`\n`;
};

let work = '';
let tree = '';
beforeAll(() => {
  if (!existsSync(join(SHOP, '.git'))) {
    throw new Error(`${SHOP} is missing: run node scripts/ensure-shop-mcp.mjs (the root pretest does)`);
  }
  work = mkdtempSync(join(tmpdir(), 'fiks-mutate-'));
  tree = join(work, 'seed-v1');
  execFileSync('mkdir', ['-p', tree]);
  // A plain export (no .git) of the base, so `git apply` acts on files only.
  execFileSync('sh', ['-c', `git -C "$0" archive ${BASE_REF} src | tar -x -C "$1"`, SHOP, tree]);
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const gitApply = (patch: string, check: boolean) =>
  execFileSync('git', ['apply', ...(check ? ['--check'] : []), patch], {
    cwd: tree,
    encoding: 'utf8',
    stdio: 'pipe',
  });

describe('mutatePatch on the D1-D5 oracle patches (stub llm)', () => {
  for (const drift of DRIFTS) {
    test(drift, { timeout: 60_000 }, async () => {
      const ref = readFileSync(join(ORACLES, `${drift}.patch`), 'utf8');
      const baseFiles = baseFilesAt(SHOP, BASE_REF, ref);
      // The oracle itself applies (sanity check on the fixture).
      const refPath = join(work, `${drift}.ref.patch`);
      writeFileSync(refPath, ref);
      gitApply(refPath, true);
      for (const op of PATCH_OPS) {
        const m = await mutatePatch(op, ref, stub, { baseFiles, context: `Drift ${drift} on shop-mcp.` });
        expect(m.ok, `${drift} ${op}: ${m.error}`).toBe(true);
        expect(m.verified).toBe(true);
        expect(m.diff).toMatch(/^diff --git a\//);
        expect(m.identicalToReference).toBe(false);
        const p = join(work, `${drift}.${op}.patch`);
        writeFileSync(p, m.diff);
        expect(() => gitApply(p, true), `${drift} ${op}\n${m.diff}`).not.toThrow();
        // Applying for real gives exactly the wrapper's in-memory result.
        gitApply(p, false);
        for (const [file, content] of Object.entries(m.result ?? {})) {
          expect(readFileSync(join(tree, file), 'utf8'), `${drift} ${op} ${file}`).toBe(content);
        }
        execFileSync('git', ['apply', '-R', p], { cwd: tree });
        // Deterministic: the same reply gives the same diff.
        const again = await mutatePatch(op, ref, stub, { baseFiles, context: `Drift ${drift} on shop-mcp.` });
        expect(again.diffSha256).toBe(m.diffSha256);
        expect(again.promptSha256).toBe(m.promptSha256);
      }
    });
  }
});

describe('mutatePatch wrapper', () => {
  const ref = () => readFileSync(join(ORACLES, 'D2.patch'), 'utf8');

  test('prompts are the committed files, filled in', () => {
    const r = ref();
    const baseFiles = baseFilesAt(SHOP, BASE_REF, r);
    const seen = new Set<string>();
    for (const op of PATCH_OPS) {
      const { system, prompt } = renderPatchPrompt(op, r, { baseFiles, context: 'ctx line' });
      const instr = readFileSync(new URL(`../prompts/${op}.md`, import.meta.url), 'utf8').trim();
      expect(prompt).toContain(instr);
      expect(prompt).toContain(`Operator ${op}:`);
      expect(prompt).toContain('ctx line');
      expect(prompt).toContain('- src/tools/get_product.ts');
      expect(prompt).toContain(r.trimEnd());
      expect(prompt).toContain('### src/tools/get_product.ts');
      expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(system).toBe(readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8').trim());
      seen.add(prompt);
    }
    expect(seen.size).toBe(PATCH_OPS.length);
  });

  test('a reply that is not a diff is a failed candidate, not a throw', async () => {
    const m = await mutatePatch('P1', ref(), async () => 'I cannot do that.', {});
    expect(m.ok).toBe(false);
    expect(m.error).toMatch(/no hunks/);
    expect(m.diff).toBe('');
  });

  test('edits outside the allowed files are rejected', async () => {
    const r = ref();
    const other = r.replaceAll('src/tools/get_product.ts', 'src/server.ts');
    const m = await mutatePatch('P2', r, async () => other, { baseFiles: baseFilesAt(SHOP, BASE_REF, r) });
    expect(m.ok).toBe(false);
    expect(m.error).toMatch(/outside the allowed set: src\/server.ts/);
  });

  test('hunks that do not match the base are rejected', async () => {
    const r = ref();
    const bad = r.replace('   category: string;', '   kategory: string;');
    const m = await mutatePatch('P3', r, async () => bad, { baseFiles: baseFilesAt(SHOP, BASE_REF, r) });
    expect(m.ok).toBe(false);
    expect(m.error).toMatch(/does not match the base source/);
  });

  test('returning the reference fix is flagged', async () => {
    const r = ref();
    const m = await mutatePatch('P5', r, async () => r, { baseFiles: baseFilesAt(SHOP, BASE_REF, r) });
    expect(m.ok).toBe(true);
    expect(m.identicalToReference).toBe(true);
  });

  test('without base files only the hunk counts are repaired', async () => {
    const r = ref();
    const sloppy = r.replace(/^@@ -23,6 \+23,7 @@/m, '@@ -23,1 +23,1 @@');
    const m = await mutatePatch('P6', r, async () => sloppy);
    expect(m.ok).toBe(true);
    expect(m.verified).toBe(false);
    expect(m.diff).toContain('@@ -23,6 +23,7 @@');
    expect(m.diff).toBe(normalizePatch(r));
  });

  test('llm errors propagate (infra errors are the caller’s)', async () => {
    await expect(
      mutatePatch('P8', ref(), async () => {
        throw new Error('rate limited');
      }),
    ).rejects.toThrow('rate limited');
  });

  test('unknown operators throw', async () => {
    await expect(mutatePatch('P9' as PatchOp, ref(), stub)).rejects.toThrow(/unknown patch operator/);
  });
});
