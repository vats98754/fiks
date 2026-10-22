// The AST detector (third SAST tool): a TypeScript-compiler walk over each file, independent of
// Semgrep's and ESLint's matchers. It resolves what a callee is bound to (imports, requires,
// namespace aliases), so `import { exec as run } from 'node:child_process'; run(cmd)` is caught.
import ts from 'typescript';
import type { SastCategory, SastFinding, SastTool, SourceFile } from './types.ts';

const CHILD_PROCESS = new Set(['child_process', 'node:child_process']);
const FS = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const VM = new Set(['vm', 'node:vm']);
const CP_FNS = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']);
const VM_FNS = new Set(['runInThisContext', 'runInNewContext', 'runInContext', 'compileFunction', 'Script']);
const FS_FNS = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'createReadStream',
  'createWriteStream',
  'open',
  'openSync',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'readdir',
  'readdirSync',
]);

/** What a local name is bound to: a module namespace, or one export of a module. */
type Binding = { module: string; member?: string };

const isStatic = (n: ts.Node | undefined): boolean => {
  if (!n) return true;
  if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return true;
  if (ts.isTemplateExpression(n)) return false;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) return isStatic(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return isStatic(n.left) && isStatic(n.right);
  return false;
};

function moduleOf(n: ts.Expression): string | undefined {
  // require('x') or await import('x')
  let e: ts.Expression = n;
  while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isCallExpression(e) && e.arguments[0] && ts.isStringLiteralLike(e.arguments[0])) {
    if (ts.isIdentifier(e.expression) && e.expression.text === 'require') return e.arguments[0].text;
    if (e.expression.kind === ts.SyntaxKind.ImportKeyword) return e.arguments[0].text;
  }
  return undefined;
}

function collectBindings(sf: ts.SourceFile): Map<string, Binding> {
  const b = new Map<string, Binding>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
      const module = n.moduleSpecifier.text;
      const c = n.importClause;
      if (c.name) b.set(c.name.text, { module });
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) b.set(nb.name.text, { module });
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          b.set(el.name.text, { module, member: (el.propertyName ?? el.name).text });
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const module = moduleOf(n.initializer);
      if (module) {
        if (ts.isIdentifier(n.name)) b.set(n.name.text, { module });
        else if (ts.isObjectBindingPattern(n.name)) {
          for (const el of n.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const member =
              el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
            b.set(el.name.text, { module, member });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return b;
}

/** The (module, member) a callee resolves to, if any. */
function resolveCallee(callee: ts.Expression, b: Map<string, Binding>): Binding | undefined {
  if (ts.isIdentifier(callee)) return b.get(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const ns = b.get(callee.expression.text);
    if (ns && !ns.member) return { module: ns.module, member: callee.name.text };
    // fs.promises.readFile(...)
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    ts.isIdentifier(callee.expression.expression)
  ) {
    const ns = b.get(callee.expression.expression.text);
    if (ns && !ns.member && callee.expression.name.text === 'promises')
      return { module: `${ns.module}/promises`, member: callee.name.text };
  }
  return undefined;
}

export function astFindings(file: SourceFile): SastFinding[] {
  const kind = /\.[cm]?jsx?$/.test(file.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, kind);
  const bindings = collectBindings(sf);
  const out: SastFinding[] = [];
  const report = (n: ts.Node, rule: string, category: SastCategory) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    out.push({ tool: 'ast', rule, category, file: file.path, line });
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const args = n.arguments ?? ts.factory.createNodeArray();
      const first = args[0];
      if (ts.isIdentifier(callee) && callee.text === 'eval' && !bindings.has('eval') && !isStatic(first)) {
        report(n, 'eval-nonliteral', 'code-eval');
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'eval' &&
        ts.isIdentifier(callee.expression) &&
        ['globalThis', 'window', 'global'].includes(callee.expression.text) &&
        !isStatic(first)
      ) {
        report(n, 'eval-nonliteral', 'code-eval');
      } else if (ts.isIdentifier(callee) && callee.text === 'Function' && !bindings.has('Function')) {
        report(n, 'function-constructor', 'code-eval');
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && !isStatic(first)) {
        report(n, 'require-nonliteral', 'dynamic-require');
      } else if (ts.isIdentifier(callee) && callee.text === 'RegExp' && !isStatic(first)) {
        report(n, 'regexp-nonliteral', 'regexp-nonliteral');
      } else {
        const target = resolveCallee(callee, bindings);
        const member = target?.member;
        if (target && member) {
          if (CHILD_PROCESS.has(target.module) && CP_FNS.has(member)) {
            const shellOpt = args.some(
              (a) =>
                ts.isObjectLiteralExpression(a) &&
                a.properties.some(
                  (p) =>
                    ts.isPropertyAssignment(p) &&
                    ts.isIdentifier(p.name) &&
                    p.name.text === 'shell' &&
                    p.initializer.kind !== ts.SyntaxKind.FalseKeyword,
                ),
            );
            if (!isStatic(first) || shellOpt) report(n, `child-process-${member}`, 'command-exec');
          } else if (VM.has(target.module) && VM_FNS.has(member)) {
            report(n, `vm-${member}`, 'code-eval');
          } else if (FS.has(target.module.replace(/\/promises$/, '')) || FS.has(target.module)) {
            if (FS_FNS.has(member) && !isStatic(first)) report(n, `fs-${member}`, 'fs-nonliteral');
          }
        }
      }
    }
    if (n.kind === ts.SyntaxKind.CallExpression) {
      const c = n as ts.CallExpression;
      if (c.expression.kind === ts.SyntaxKind.ImportKeyword && !isStatic(c.arguments[0])) {
        report(n, 'import-nonliteral', 'dynamic-require');
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export const astTool: SastTool = {
  name: 'ast',
  async scan(files) {
    return files.flatMap(astFindings);
  },
};
