// eslint-plugin-security (second SAST tool), run through ESLint's Linter API in memory. TypeScript
// is reduced to JavaScript with Node's whitespace-preserving type stripping, so every reported
// line and column is the line and column of the original file.
import { stripTypeScriptTypes } from 'node:module';
import { Linter } from 'eslint';
import security from 'eslint-plugin-security';
import ts from 'typescript';
import type { SastCategory, SastFinding, SastTool, SourceFile } from './types.ts';

/** eslint-plugin-security rule -> shared category. */
export const ESLINT_CATEGORY: Record<string, SastCategory> = {
  'detect-eval-with-expression': 'code-eval',
  'detect-child-process': 'command-exec',
  'detect-non-literal-require': 'dynamic-require',
  'detect-non-literal-fs-filename': 'fs-nonliteral',
  'detect-non-literal-regexp': 'regexp-nonliteral',
  'detect-unsafe-regex': 'unsafe-regex',
  'detect-object-injection': 'object-injection',
  'detect-pseudoRandomBytes': 'weak-random',
  'detect-possible-timing-attacks': 'timing-attack',
  'detect-new-buffer': 'buffer',
  'detect-buffer-noassert': 'buffer',
  'detect-bidi-characters': 'hidden-chars',
  'detect-invisible-characters': 'hidden-chars',
  'detect-disable-mustache-escape': 'other',
  'detect-no-csrf-before-method-override': 'other',
};

const plugin = security as unknown as { rules: Record<string, unknown> };

const CONFIG: Linter.Config[] = [
  {
    plugins: { security: security as unknown as NonNullable<Linter.Config['plugins']>[string] },
    rules: Object.fromEntries(Object.keys(plugin.rules).map((r) => [`security/${r}`, 'warn' as const])),
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
];

/** TypeScript -> JavaScript with identical line/column positions (falls back to tsc's emit). */
export function toJavaScript(file: SourceFile): string {
  if (!/\.(?:[cm]?ts|tsx)$/.test(file.path)) return file.source;
  const emit = process.emitWarning;
  try {
    // stripTypeScriptTypes is experimental in Node 22 and warns once per process.
    process.emitWarning = () => undefined;
    return stripTypeScriptTypes(file.source, { mode: 'strip' });
  } catch {
    return ts.transpileModule(file.source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
  } finally {
    process.emitWarning = emit;
  }
}

export function eslintFindings(file: SourceFile): SastFinding[] {
  const linter = new Linter({ configType: 'flat' });
  const filename = file.path.replace(/\.(?:[cm]?ts|tsx)$/, '.js');
  const messages = linter.verify(toJavaScript(file), CONFIG, { filename });
  const out: SastFinding[] = [];
  for (const m of messages) {
    if (!m.ruleId?.startsWith('security/')) continue;
    const rule = m.ruleId.slice('security/'.length);
    out.push({
      tool: 'eslint-security',
      rule,
      category: ESLINT_CATEGORY[rule] ?? 'other',
      file: file.path,
      line: m.line,
    });
  }
  return out;
}

export const eslintTool: SastTool = {
  name: 'eslint-security',
  async scan(files) {
    return files.flatMap(eslintFindings);
  },
};
