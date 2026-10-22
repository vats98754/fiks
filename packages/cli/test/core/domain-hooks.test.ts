// Domain hooks wired into packages/repro (PLAN P8, round 5): the shop reproEmitter is
// byte-identical to ec241bc's generateRepro; a stub Domain's emitter and suite are what
// `fiks repro --domain stub` runs; failGate judges only failures inside the suite scope.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDomain } from '@fiks/domains';
import { createWorktree, generateRepro, loadTrace, shopReproEmitter } from '@fiks/repro';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { shopDir } from '../../src/paths.ts';
import { ec241bcTree, privateCli, runCli, TSX } from './support/cli.ts';

const D2 = new URL('./fixtures/D2-trace.json', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'fiks-domain-hooks-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeAll(async () => {
  await import('../../src/bootstrap/00-shop.ts');
});

test('(a) the shop reproEmitter on D2-trace.json emits the bytes ec241bc generateRepro writes', async () => {
  const tree = ec241bcTree();
  const old = createWorktree(shopDir(), 'seed-v1', { dir: join(tmp, 'old') });
  const now = createWorktree(shopDir(), 'seed-v1', { dir: join(tmp, 'now') });
  try {
    // ec241bc: generateRepro from the ec241bc tree, into a shop-mcp worktree.
    const script = join(tmp, 'gen-ec241bc.ts');
    writeFileSync(
      script,
      `import { generateRepro, loadTrace } from ${JSON.stringify(join(tree.dir, 'packages/repro/src/index.ts'))};
const [file, repo] = process.argv.slice(2) as [string, string];
console.log(JSON.stringify(generateRepro(loadTrace(file), file, repo)));
`,
    );
    const r = spawnSync(TSX, [script, D2, old.dir], { cwd: tree.dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const oldSpec = JSON.parse(r.stdout.trim()) as { testPath: string; tracePath: string };

    const trace = loadTrace(D2);
    const spec = {
      traceId: trace.id,
      propertyIds: ['shop.get_product/price.notNull'],
      testPath: `test/repro/${trace.id}.test.ts`,
      tracePath: `test/repro/${trace.id}.json`,
    };
    expect([oldSpec.testPath, oldSpec.tracePath]).toEqual([spec.testPath, spec.tracePath]);
    const emitted = shopReproEmitter(trace, spec);
    expect(emitted.testPath).toBe(spec.testPath);
    expect(emitted.files.map((f) => f.path)).toEqual([spec.tracePath, spec.testPath]);
    for (const f of emitted.files) {
      expect(Buffer.from(f.bytes).equals(readFileSync(join(old.dir, f.path))), f.path).toBe(true);
    }
    // generateRepro through the registered shop Domain writes the same bytes.
    const newSpec = generateRepro(trace, D2, now.dir, 'shop');
    expect(newSpec).toEqual({ ...spec, testPath: oldSpec.testPath });
    for (const p of [spec.tracePath, spec.testPath]) {
      expect(readFileSync(join(now.dir, p)).equals(readFileSync(join(old.dir, p))), p).toBe(true);
    }
  } finally {
    old.remove();
    now.remove();
    tree.cleanup();
  }
}, 180_000);

const STUB_BOOTSTRAP = `// Temporary stub Domain for domain-hooks.test.ts.
import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerDomain } from '@fiks/domains';
import type { Domain, SuiteRun } from '@fiks/interfaces';
import { globToRegExp } from '@fiks/repro';
import { stubBase } from '../../test/seed/fixtures/stub.ts';

const spy = process.env.FIKS_STUB_SPY as string;
const scope = (process.env.FIKS_STUB_SCOPE ?? 'test/stub/**').split(',');
const inScope = (file: string, sc: readonly string[]) => sc.some((g) => globToRegExp(g).test(file));
const stub: Domain = {
  ...stubBase('stub'),
  repo: { slug: 'vats98754/stub-mcp', dir: () => process.env.FIKS_STUB_REPO as string },
  reproEmitter(trace, spec) {
    appendFileSync(spy, \`emitter \${trace.id}\\n\`);
    const testPath = \`test/stub/\${trace.id}.check.js\`;
    return {
      files: [
        { path: spec.tracePath, bytes: JSON.stringify(trace) },
        { path: testPath, bytes: '// stub repro\\n' },
      ],
      testPath,
    };
  },
  suite: {
    scope,
    run(repoDir, sc = scope): SuiteRun {
      appendFileSync(spy, \`suite \${sc.join(',')}\\n\`);
      const repro = readdirSync(join(repoDir, 'test/stub')).map((f) => \`test/stub/\${f}\`);
      return {
        exitCode: 1,
        failed: [
          ...repro.map((file) => ({ file, test: 'stub repro', message: 'AssertionError: shop.get_product/price.notNull violated (stub)' })),
          { file: 'test/other/planted.test.ts', test: 'planted', message: 'AssertionError: planted failure' },
        ],
        files: [...repro.map((file) => ({ file, statuses: ['failed'] })), { file: 'test/other/planted.test.ts', statuses: ['failed'] }],
        suiteErrors: [],
        logPath: '/dev/null',
        command: \`stub-suite \${sc.join(' ')}\`,
      };
    },
    oneFailingInScope: (run, sc = scope) => run.failed.filter((f) => inScope(f.file, sc)).length === 1,
  },
  allowedEditPaths: ['^lib/.+\\\\.js$'],
};
registerDomain(stub);
`;

test('(b) fiks repro --domain stub runs the stub emitter and only its suite; failGate ignores failures outside the scope', async () => {
  const repo = join(tmp, 'stub-repo');
  mkdirSync(join(repo, 'lib'), { recursive: true });
  writeFileSync(join(repo, 'lib/index.js'), 'export const x = 1;\n');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'stub');
  g('tag', '-a', 'stub-v1', '-m', 'stub base');
  // The stub bootstrap goes into a private copy of the CLI, not the real packages/cli/src.
  const cli = privateCli();
  const bootstrap = join(cli.src, 'bootstrap/zz-stub-domain.ts');
  writeFileSync(bootstrap, STUB_BOOTSTRAP);
  try {
    const run = (scope?: string) => {
      const spy = join(tmp, `spy-${scope ? 'all' : 'scoped'}.log`);
      writeFileSync(spy, '');
      const r = runCli(
        ['repro', '--domain', 'stub', '--trace', D2, '--target', 'stub-v1', '--runs', '2', '--json'],
        {
          src: cli.src,
          env: { FIKS_STUB_SPY: spy, FIKS_STUB_REPO: repo, ...(scope ? { FIKS_STUB_SCOPE: scope } : {}) },
        },
      );
      return { r, spy: readFileSync(spy, 'utf8').trim().split('\n') };
    };
    const scoped = run();
    expect(scoped.r.status, scoped.r.stderr).toBe(0);
    const out = JSON.parse(scoped.r.stdout);
    expect(out.gateF.ok).toBe(true);
    expect(out.gateF.reason).toBe('fails for the stated reason on 2/2 runs');
    expect(out.gateF.evidence.command).toBe('stub-suite test/stub/**');
    expect(out.spec.testPath).toBe('test/stub/tr_079b90c89e.check.js');
    expect(scoped.spy).toEqual(['emitter tr_079b90c89e', 'suite test/stub/**', 'suite test/stub/**']);
    // Control: with the whole suite in scope the planted failure counts, and F fails.
    const whole = run('**');
    expect(whole.r.status).toBe(1);
    expect(JSON.parse(whole.r.stdout).gateF.reason).toMatch(
      /other tests fail too: test\/other\/planted.test.ts > planted/,
    );
  } finally {
    rmSync(bootstrap, { force: true });
    cli.cleanup();
  }
}, 180_000);

test("(c) getDomain('shop').allowedEditPaths equals ['^src/.+\\\\.ts$']", () => {
  expect(getDomain('shop').allowedEditPaths).toEqual(['^src/.+\\.ts$']);
  // = ec241bc's REPAIR_ALLOWED regex source.
  const guard = execFileSync('git', ['show', 'ec241bc:packages/repair/src/guard.ts'], {
    cwd: new URL('../../../../', import.meta.url).pathname,
    encoding: 'utf8',
  });
  const m = /REPAIR_ALLOWED = \(f: string\) => \/(.+)\/\.test\(f\);/.exec(guard);
  expect(m?.[1]).toBeDefined();
  expect(new RegExp(m?.[1] as string).source.replace(/\\\//g, '/')).toBe('^src/.+\\.ts$');
});
