// Per-repo Linux sandbox image (PLAN P1): node_modules from the target repo's lockfile and an offline
// pnpm store. The build context is only the lockfile inputs at a commit (package.json files,
// pnpm-lock.yaml, .npmrc, pnpm-workspace.yaml), the git shim and the Dockerfile, so rebuilding from
// the same lockfile reuses every layer and yields the same image digest.
//
// usage: pnpm tsx packages/sandbox/src/build.ts --repo .work/shop-mcp [--ref HEAD] [--json]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertDocker, dockerOk, imageDigest } from './docker.ts';
import { withLock } from './lock.ts';

export const DOCKER_DIR = fileURLToPath(new URL('../docker/', import.meta.url));
/** Base image of every sandbox image (multi-arch index digest of node:22.23.3-bookworm-slim). */
export const BASE_IMAGE =
  'node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

/** Workspace package dirs named in a pnpm v9 lockfile's `importers:` block ('.' = the root). */
export function lockImporters(lock: string): string[] {
  const out: string[] = [];
  let inImporters = false;
  for (const line of lock.split('\n')) {
    if (/^importers:\s*$/.test(line)) {
      inImporters = true;
      continue;
    }
    if (inImporters && /^\S/.test(line)) break;
    const m = inImporters ? /^ {2}(['"]?)([^'":\s][^'":]*)\1:\s*(\{\})?\s*$/.exec(line) : null;
    if (m?.[2]) out.push(m[2]);
  }
  return out.length ? out : ['.'];
}

/** The files `pnpm install --frozen-lockfile` reads, at `commit` (path -> contents). */
export function manifestFiles(repo: string, commit: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const show = (path: string): Buffer | undefined => {
    try {
      return execFileSync('git', ['show', `${commit}:${path}`], {
        cwd: repo,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return undefined;
    }
  };
  const lock = show('pnpm-lock.yaml');
  if (!lock) throw new Error(`${repo}@${commit}: no pnpm-lock.yaml (only pnpm repos are supported)`);
  files.set('pnpm-lock.yaml', lock);
  for (const f of ['.npmrc', 'pnpm-workspace.yaml', '.pnpmfile.cjs']) {
    const b = show(f);
    if (b) files.set(f, b);
  }
  for (const dir of lockImporters(lock.toString('utf8'))) {
    const p = dir === '.' ? 'package.json' : `${dir}/package.json`;
    const b = show(p);
    if (!b) throw new Error(`${repo}@${commit}: lockfile importer ${dir} has no package.json`);
    files.set(p, b);
  }
  return files;
}

export interface RepoImage {
  repo: string;
  commit: string;
  /** sha256 over the manifest files (sorted path + bytes): the lockfile identity of the image. */
  lockSha256: string;
  tag: string;
  /** `sha256:…` image id; runs reference the image by this value. */
  digest: string;
  base: string;
}

export function manifestHash(files: Map<string, Buffer>): string {
  const h = createHash('sha256');
  for (const [p, b] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    h.update(`${p}\0${b.length}\0`);
    h.update(b);
  }
  return h.digest('hex');
}

export async function buildRepoImage(opts: {
  repo: string;
  ref?: string;
  echo?: boolean;
}): Promise<RepoImage> {
  assertDocker();
  const repo = realpathSync(resolve(opts.repo));
  const commit = git(repo, 'rev-parse', `${opts.ref ?? 'HEAD'}^{commit}`).trim();
  const files = manifestFiles(repo, commit);
  const lockSha256 = manifestHash(files);
  const name = basename(repo)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const tag = `fiks-sbx/${name}:${lockSha256.slice(0, 16)}`;
  const ctx = mkdtempSync(join(tmpdir(), 'fiks-sbx-ctx-'));
  try {
    for (const [p, b] of files) {
      mkdirSync(dirname(join(ctx, 'manifest', p)), { recursive: true });
      writeFileSync(join(ctx, 'manifest', p), b);
    }
    copyFileSync(join(DOCKER_DIR, 'repo.Dockerfile'), join(ctx, 'Dockerfile'));
    copyFileSync(join(DOCKER_DIR, 'git-shim.sh'), join(ctx, 'git-shim.sh'));
    await withLock('docker', () =>
      dockerOk(['build', '--progress=plain', '--pull=false', '-t', tag, '-f', join(ctx, 'Dockerfile'), ctx], {
        echo: opts.echo,
        timeoutMs: 30 * 60_000,
      }),
    );
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
  return { repo, commit, lockSha256, tag, digest: await imageDigest(tag), base: BASE_IMAGE };
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      ref: { type: 'string', default: 'HEAD' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  });
  if (!values.repo) {
    console.error('usage: build.ts --repo <dir> [--ref HEAD] [--json]');
    return 2;
  }
  const img = await buildRepoImage({
    repo: values.repo,
    ref: values.ref,
    echo: !values.quiet && !values.json,
  });
  if (values.json) console.log(JSON.stringify(img, null, 2));
  else {
    console.log(`image: ${img.tag}`);
    console.log(`repo: ${img.repo} @ ${img.commit}`);
    console.log(`lockfile sha256: ${img.lockSha256}`);
    console.log(`digest: ${img.digest}`);
  }
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(`build: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
