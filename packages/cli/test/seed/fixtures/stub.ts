// A stub Domain for the seed tests: every member defined, nothing real behind it.
import type { AllowedEditPaths, Domain, DomainSuite, ReproEmitter, SuiteRun } from '@fiks/interfaces';

export type DomainWithoutHooks = Omit<Domain, 'reproEmitter' | 'suite' | 'allowedEditPaths'>;

export function stubBase(id: string): DomainWithoutHooks {
  return {
    id,
    createVendor: () => ({
      state: {},
      reset() {},
      listen: async () => 'http://127.0.0.1:0',
      close: async () => {},
    }),
    frozenClock: '2026-10-01T12:00:00.000Z',
    truth: () => ({ inputValid: true, expected: null }),
    entityClass: () => ({ '': 'all' }),
    originEntity: () => ({ '': 'q-0' }),
    injectorHook: (rule) => ({
      name: `injector:${rule.id}`,
      start: async (target) => ({ url: target, close: async () => {} }),
    }),
    versionHeader: 'stub-api-version',
    contractsPath: '/dev/null',
    baseUrlEnv: 'STUB_API_URL',
    serverCommand: (repoDir) => ({ command: 'node', args: ['src/main.ts'], cwd: repoDir }),
    repo: { slug: 'vats98754/stub-mcp', dir: () => '/nonexistent/stub-mcp' },
    seedTag: 'seed-stub-v1',
    scenarios: {},
    fixtureCalls: [],
    tasks: [],
    promptHints: { repair: [] },
    enumerate: () => [],
    paginatedEndpoints: [],
  };
}

export const stubReproEmitter: ReproEmitter = (trace, spec) => ({
  files: [
    { path: spec.tracePath, bytes: JSON.stringify(trace) },
    { path: spec.testPath, bytes: `// repro for ${trace.id}\n` },
  ],
  testPath: spec.testPath,
});

const emptyRun = (command: string): SuiteRun => ({
  exitCode: 0,
  failed: [],
  files: [],
  suiteErrors: [],
  logPath: '/dev/null',
  command,
});

export const stubSuite: DomainSuite = {
  run: (repoDir, scope) => emptyRun(`stub-test ${repoDir} ${(scope ?? ['**']).join(' ')}`),
  scope: ['test/**'],
  oneFailingInScope: (run) => run.failed.length === 1,
};

export const stubAllowedEditPaths: AllowedEditPaths = ['^src/.+\\.ts$'];

export function stubDomain(id: string): Domain {
  return {
    ...stubBase(id),
    reproEmitter: stubReproEmitter,
    suite: stubSuite,
    allowedEditPaths: stubAllowedEditPaths,
  };
}
