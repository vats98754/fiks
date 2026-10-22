// SAST on the diff only (PLAN 3.0 criterion 4, 5.8): three independent tools, one shared
// vocabulary of categories. A finding is new when it sits on a line the patch adds and the base
// file has no finding of the same tool and category on an identical line. A new finding counts
// against the patch only when >= 2 of the 3 tools report it (same file, same category, within
// LINE_TOLERANCE lines) [sajadi2025patches].

export type SastToolName = 'semgrep' | 'eslint-security' | 'ast';

export const SAST_TOOLS: readonly SastToolName[] = ['semgrep', 'eslint-security', 'ast'];

/** The categories a confirmation can be reached on (tools report in these terms). */
export type SastCategory =
  | 'code-eval'
  | 'command-exec'
  | 'dynamic-require'
  | 'fs-nonliteral'
  | 'regexp-nonliteral'
  | 'unsafe-regex'
  | 'object-injection'
  | 'weak-random'
  | 'timing-attack'
  | 'buffer'
  | 'hidden-chars'
  | 'other';

export interface SourceFile {
  /** Repo-relative path. */
  path: string;
  source: string;
}

export interface SastFinding {
  tool: SastToolName;
  rule: string;
  category: SastCategory;
  /** Repo-relative path. */
  file: string;
  /** 1-based line. */
  line: number;
}

export interface SastTool {
  name: SastToolName;
  /** Findings in `files` (paths are reported back unchanged). */
  scan(files: readonly SourceFile[]): Promise<SastFinding[]>;
}

/** Lines between two tools' reports of the same construct (a call can span lines). */
export const LINE_TOLERANCE = 2;

/** Files SAST reads (JavaScript and TypeScript sources). */
export const SAST_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
