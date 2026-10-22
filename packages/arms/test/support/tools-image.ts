// The fiks-tools image ARMS's container tests use: SBX's test-only image of this checkout's HEAD
// (`build-tools.ts --ref HEAD --apply-fragments`), so fiks-iv and the arms code inside it are the
// code under test. FIKS_TOOLS_IMAGE overrides it.
//
// Injector-rule drifts (D3/D4 as INJ rules, the planted-FP D4 trace, TRK-DEV-1) re-record through
// the injector factory that ORCH's packages/cli/src/bootstrap/30-injector.ts registers. While that
// file is not in HEAD (ORCH unmerged), the image is built from a throwaway clone of HEAD plus one
// TEST-ONLY bootstrap file, bootstrap/35-arms-test-injector.ts, which registers
// test/support/injector.ts's factory (packages/injector startInjector). It is never committed to
// fiks; once 30-injector.ts is in HEAD the image is exactly `--ref HEAD --apply-fragments`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToolsImage } from '@fiks/sandbox';
import { ROOT } from './fixtures.ts';

const ORCH_INJECTOR = 'packages/cli/src/bootstrap/30-injector.ts';
export const TEST_INJECTOR_BOOTSTRAP = 'packages/cli/src/bootstrap/35-arms-test-injector.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();

export const headHasOrchInjector = () => {
  try {
    git(ROOT, 'cat-file', '-e', `HEAD:${ORCH_INJECTOR}`);
    return true;
  } catch {
    return false;
  }
};

export interface TestToolsImage {
  digest: string;
  commit: string;
  /** True when the image carries ARMS's test-only injector bootstrap (ORCH's is not in HEAD). */
  testInjector: boolean;
}

let cached: Promise<TestToolsImage> | undefined;

export function testToolsImage(): Promise<TestToolsImage> {
  cached ??= (async () => {
    const head = git(ROOT, 'rev-parse', 'HEAD');
    if (process.env.FIKS_TOOLS_IMAGE)
      return { digest: process.env.FIKS_TOOLS_IMAGE, commit: head, testInjector: !headHasOrchInjector() };
    const dirty = git(
      ROOT,
      'status',
      '--porcelain',
      '--',
      'packages/arms',
      'packages/cli/src/commands/arm.ts',
    );
    if (dirty)
      console.warn(`[arms tests] packages/arms has uncommitted changes; the tools image holds HEAD ${head}`);
    if (headHasOrchInjector()) {
      const img = await buildToolsImage({ ref: 'HEAD', applyFragments: true });
      return { digest: img.digest, commit: img.commit, testInjector: false };
    }
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arms-tools-')));
    try {
      const repo = join(tmp, 'fiks');
      execFileSync('git', ['clone', '--quiet', '--no-checkout', '--no-hardlinks', ROOT, repo], {
        stdio: 'pipe',
      });
      git(repo, 'checkout', '--quiet', '--detach', head);
      writeFileSync(
        join(repo, TEST_INJECTOR_BOOTSTRAP),
        "// TEST-ONLY (ARMS container tests; never committed to fiks): the injector factory that ORCH's\n// bootstrap/30-injector.ts registers, until that file is merged.\nimport { registerArmsTestInjector } from '../../../arms/test/support/injector.ts';\n\nregisterArmsTestInjector();\n",
      );
      git(repo, 'add', TEST_INJECTOR_BOOTSTRAP);
      execFileSync(
        'git',
        [
          '-c',
          'user.name=arms-test',
          '-c',
          'user.email=arms-test@localhost',
          'commit',
          '--quiet',
          '-m',
          'test-only injector bootstrap',
        ],
        {
          cwd: repo,
          stdio: 'pipe',
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: '2026-10-01T12:00:00Z',
            GIT_COMMITTER_DATE: '2026-10-01T12:00:00Z',
          },
        },
      );
      const img = await buildToolsImage({ repo, ref: 'HEAD', applyFragments: true });
      return { digest: img.digest, commit: head, testInjector: true };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return cached;
}
