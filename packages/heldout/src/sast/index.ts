// The SAST criterion over one patch (PLAN 3.0 criterion 4): the changed JavaScript/TypeScript files
// at base and at head go to all three tools; findings on lines the patch adds that the base does
// not already have are new; a new finding confirmed by >= 2 tools fails the criterion.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedDiff } from '../diff.ts';
import { astTool } from './ast.ts';
import { eslintTool } from './eslint.ts';
import { semgrepTool } from './semgrep.ts';
import {
  LINE_TOLERANCE,
  SAST_FILE,
  type SastCategory,
  type SastFinding,
  type SastTool,
  type SastToolName,
  type SourceFile,
} from './types.ts';

export * from './ast.ts';
export * from './eslint.ts';
export * from './semgrep.ts';
export * from './types.ts';

export interface ConfirmedFinding {
  file: string;
  line: number;
  category: SastCategory;
  tools: SastToolName[];
  rules: string[];
}

export interface SastResult {
  /** Every new finding (any tool). */
  newFindings: SastFinding[];
  /** New findings reported by >= 2 tools: the criterion fails iff this is non-empty. */
  confirmed: ConfirmedFinding[];
  pass: boolean;
  /** Files scanned (head side). */
  files: string[];
}

export const defaultSastTools = (): SastTool[] => [semgrepTool(), eslintTool, astTool];

const lineAt = (src: string, line: number) => (src.split('\n')[line - 1] ?? '').trim();

/**
 * Runs the SAST criterion on `diff`, reading base sources from `baseDir` and head sources from
 * `headDir` (nothing is executed). `tools` defaults to Semgrep CE, eslint-plugin-security and the
 * AST detector.
 */
export async function sastOnDiff(opts: {
  baseDir: string;
  headDir: string;
  diff: string;
  tools?: SastTool[];
}): Promise<SastResult> {
  const tools = opts.tools ?? defaultSastTools();
  const changed = parseUnifiedDiff(opts.diff).filter(
    (f) => f.newPath !== null && SAST_FILE.test(f.newPath) && f.added.length > 0,
  );
  const read = (dir: string, p: string | null): SourceFile | undefined => {
    if (!p || !existsSync(join(dir, p))) return undefined;
    return { path: p, source: readFileSync(join(dir, p), 'utf8') };
  };
  const heads = changed.map((f) => read(opts.headDir, f.newPath)).filter((f): f is SourceFile => !!f);
  const bases = changed
    .map((f) => {
      const b = read(opts.baseDir, f.oldPath);
      // Base findings are keyed by the head path, so a rename compares like with like.
      return b && f.newPath ? { ...b, path: f.newPath } : undefined;
    })
    .filter((f): f is SourceFile => !!f);
  const headSrc = new Map(heads.map((f) => [f.path, f.source]));
  const baseSrc = new Map(bases.map((f) => [f.path, f.source]));
  const added = new Map(changed.map((f) => [f.newPath as string, new Set(f.added)]));

  const newFindings: SastFinding[] = [];
  // One scan per tool over both sides (base files under base/, head files under head/).
  const both = [
    ...heads.map((f) => ({ ...f, path: `head/${f.path}` })),
    ...bases.map((f) => ({ ...f, path: `base/${f.path}` })),
  ];
  for (const tool of tools) {
    const all = await tool.scan(both);
    const side = (prefix: string) =>
      all.filter((x) => x.file.startsWith(prefix)).map((x) => ({ ...x, file: x.file.slice(prefix.length) }));
    const h = side('head/');
    const b = side('base/');
    const baseKeys = new Set(
      b.map((x) => `${x.category}\u0000${x.file}\u0000${lineAt(baseSrc.get(x.file) ?? '', x.line)}`),
    );
    for (const x of h) {
      if (!added.get(x.file)?.has(x.line)) continue;
      const key = `${x.category}\u0000${x.file}\u0000${lineAt(headSrc.get(x.file) ?? '', x.line)}`;
      if (!baseKeys.has(key)) newFindings.push(x);
    }
  }
  newFindings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.tool.localeCompare(b.tool) ||
      a.rule.localeCompare(b.rule),
  );
  const confirmed = confirm(newFindings);
  return { newFindings, confirmed, pass: confirmed.length === 0, files: heads.map((f) => f.path).sort() };
}

/** Groups new findings by (file, category) within LINE_TOLERANCE lines; >= 2 tools confirms. */
export function confirm(findings: readonly SastFinding[]): ConfirmedFinding[] {
  const out: ConfirmedFinding[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const near = findings.filter(
      (g) => g.file === f.file && g.category === f.category && Math.abs(g.line - f.line) <= LINE_TOLERANCE,
    );
    const tools = [...new Set(near.map((g) => g.tool))].sort();
    if (tools.length < 2) continue;
    const line = Math.min(...near.map((g) => g.line));
    const key = `${f.file}\u0000${f.category}\u0000${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      file: f.file,
      line,
      category: f.category,
      tools,
      rules: [...new Set(near.map((g) => g.rule))].sort(),
    });
  }
  return out;
}
