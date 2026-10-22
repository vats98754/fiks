// fiks-tools image (PLAN P1 round 6, round 7): `git archive <commit>` of the fiks repo (so no .env,
// .fiks or .work can be in it) + `pnpm install --frozen-lockfile` inside Linux. During the build
// phase <commit> is the latest merged main. A stream that needs its own unmerged code inside the
// container builds a test-only image with `--ref HEAD --apply-fragments` (fragments applied and
// `pnpm install --no-frozen-lockfile` inside the build); such an image is labelled
// fiks.tools.testOnly=true and its digest is never used by a run (toolsMounts refuses it).
//
// usage: pnpm tsx packages/sandbox/src/build-tools.ts [--repo <fiks checkout>] [--ref main]
//                                                     [--apply-fragments] [--json]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DOCKER_DIR } from './build.ts';
import { assertDocker, dockerOk, imageDigest } from './docker.ts';
import { withLock } from './lock.ts';

/** The fiks checkout this file belongs to. */
export const FIKS_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');

/** Paths that must never be in a tools image (secrets, scratch, clones). */
export const FORBIDDEN_TOP = ['.env', '.fiks', '.work'];

export interface ToolsImage {
  repo: string;
  ref: string;
  commit: string;
  tag: string;
  digest: string;
  testOnly: boolean;
}

/** Top-level entries of a `git archive --prefix=fiks/` tarball that are forbidden. */
export function forbiddenEntries(tarList: string[]): string[] {
  return tarList.filter((p) => {
    const top = p.replace(/^fiks\//, '').split('/')[0] ?? '';
    return FORBIDDEN_TOP.includes(top) || /(^|\/)\.env$/.test(p);
  });
}

export async function buildToolsImage(
  opts: { repo?: string; ref?: string; applyFragments?: boolean; echo?: boolean } = {},
): Promise<ToolsImage> {
  assertDocker();
  const repo = realpathSync(resolve(opts.repo ?? FIKS_ROOT));
  const ref = opts.ref ?? 'main';
  const testOnly = Boolean(opts.applyFragments);
  const commit = execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const ctx = mkdtempSync(join(tmpdir(), 'fiks-tools-ctx-'));
  try {
    const tar = join(ctx, 'fiks.tar');
    execFileSync('git', ['archive', '--format=tar', '--prefix=fiks/', '-o', tar, commit], { cwd: repo });
    const list = execFileSync('tar', ['-tf', tar], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean);
    const bad = forbiddenEntries(list);
    if (bad.length)
      throw new Error(`refusing to build fiks-tools: ${commit} tracks ${bad.slice(0, 5).join(', ')}`);
    copyFileSync(join(DOCKER_DIR, 'tools.Dockerfile'), join(ctx, 'Dockerfile'));
    const tag = `${testOnly ? 'fiks-tools-test' : 'fiks-tools'}:${commit.slice(0, 12)}`;
    await withLock('docker', () =>
      dockerOk(
        [
          'build',
          '--progress=plain',
          '--pull=false',
          '--build-arg',
          `FIKS_COMMIT=${commit}`,
          '--build-arg',
          `TEST_ONLY=${testOnly}`,
          '--build-arg',
          `APPLY_FRAGMENTS=${testOnly ? 1 : 0}`,
          '-t',
          tag,
          '-f',
          join(ctx, 'Dockerfile'),
          ctx,
        ],
        { echo: opts.echo, timeoutMs: 45 * 60_000 },
      ),
    );
    return { repo, ref, commit, tag, digest: await imageDigest(tag), testOnly };
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      ref: { type: 'string', default: 'main' },
      'apply-fragments': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  });
  const img = await buildToolsImage({
    repo: values.repo,
    ref: values.ref,
    applyFragments: values['apply-fragments'],
    echo: !values.quiet && !values.json,
  });
  if (values.json) console.log(JSON.stringify(img, null, 2));
  else {
    console.log(`image: ${img.tag}`);
    console.log(`fiks: ${img.repo} ${img.ref} = ${img.commit}`);
    console.log(
      img.testOnly
        ? `digest: ${img.digest} (TEST-ONLY: fragments applied, --no-frozen-lockfile; never used by a run)`
        : `digest: ${img.digest}`,
    );
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`build-tools: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
