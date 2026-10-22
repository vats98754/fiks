// R20 process-level replay (Figma-Context-MCP #364), sandboxed (PLAN 5.10 step 8, P1). The
// server is built and run only inside the SBX per-repo image (node_modules from the clone's
// lockfile, --network none, read-only root, HOME=/tmp, no host env): nothing from the clone runs
// on the host. One container per harness invocation; every case run spawns a fresh server process
// over MCP stdio, with a fresh case root, through harness/sandbox/case-runner.mjs.
//
// The upstream (api.figma.com and the S3 image hosts) is hard-coded https, so the replay is the
// proxy form of the RBX HTTPS shim: the leaf certificate comes from @fiks/replay-proc's throwaway
// CA (openssl on the host); the loopback CONNECT proxy that serves it runs in the container.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createCertificateAuthority } from '../../../packages/replay-proc/src/index.ts';
import {
  buildRepoImage,
  DockerExecBackend,
  docker,
  imageDigest,
  manifestFiles,
  manifestHash,
  SANDBOX_ENV,
} from '../../../packages/sandbox/src/index.ts';
import { buildsDir, HARNESS_DIR, repoDir } from './paths.ts';
import type { Case, CaseRun } from './types.ts';

export class SetupError extends Error {}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** `prefix`, `fix` (local tags made by ensure-realbugs) or any commit-ish -> full SHA. */
export function resolveSha(ref: string, repo = repoDir()): string {
  if (!existsSync(join(repo, '.git'))) {
    throw new SetupError(
      `${repo} is not a clone; run: node scripts/ensure-realbugs.mjs --id R20 (or set FIKS_REALBUG_DIR)`,
    );
  }
  try {
    return git(repo, 'rev-parse', '--verify', '-q', `${ref}^{commit}`);
  } catch {
    throw new SetupError(`${ref} does not name a commit in ${repo}`);
  }
}

async function withDirLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid = 0;
      try {
        pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
      } catch {}
      let alive = false;
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (err) {
          alive = (err as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      if (pid > 0 && !alive) rmSync(lock, { recursive: true, force: true });
      else if (i > 2400) throw new Error(`timed out waiting for ${lock}`);
      else await sleep(500);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** The SBX per-repo image for `ref` of `repo` (reused when its lockfile tag exists; else built). */
export async function ensureImage(repo: string, ref: string, log: (s: string) => void): Promise<string> {
  const commit = git(repo, 'rev-parse', `${ref}^{commit}`);
  const name = basename(repo)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  const tag = `fiks-sbx/${name}:${manifestHash(manifestFiles(repo, commit)).slice(0, 16)}`;
  const have = await docker(['image', 'inspect', '--format', '{{.Id}}', tag]);
  if (have.code === 0 && have.stdout.trim()) return have.stdout.trim();
  log(`[r20] building sandbox image ${tag} (lockfile of ${commit.slice(0, 12)})`);
  const img = await buildRepoImage({ repo, ref: commit });
  return img.digest || (await imageDigest(img.tag));
}

export interface Build {
  sha: string | null;
  tree: string;
  /** Rebuild dist on every start (an agent's worktree) instead of trusting the stamp. */
  always: boolean;
  image: string;
}

/** `--sha <ref>`: a detached worktree of the clone at `<builds>/<sha>`; `--worktree <dir>`: as is. */
export async function prepareBuild(
  sel: { sha?: string; worktree?: string },
  log: (s: string) => void = (s) => process.stderr.write(`${s}\n`),
): Promise<Build> {
  if (sel.worktree) {
    const tree = resolve(sel.worktree);
    if (!existsSync(join(tree, 'src', 'mcp', 'tools', 'download-figma-images-tool.ts'))) {
      throw new SetupError(`${tree} is not a Figma-Context-MCP tree`);
    }
    let sha: string | null = null;
    try {
      sha = git(tree, 'rev-parse', 'HEAD');
    } catch {}
    return { sha, tree, always: true, image: await ensureImage(tree, 'HEAD', log) };
  }
  const repo = repoDir();
  const sha = resolveSha(sel.sha ?? 'prefix', repo);
  const tree = join(buildsDir(), sha);
  await withDirLock(tree, async () => {
    if (!existsSync(join(tree, '.git'))) {
      mkdirSync(dirname(tree), { recursive: true });
      log(`[r20] worktree ${sha.slice(0, 12)} -> ${tree}`);
      git(repo, 'worktree', 'prune');
      git(repo, 'worktree', 'add', '--detach', tree, sha);
    }
    const head = git(tree, 'rev-parse', 'HEAD');
    if (head !== sha) throw new SetupError(`${tree} is at ${head}, expected ${sha}`);
  });
  return { sha, tree, always: false, image: await ensureImage(repo, sha, log) };
}

const SESSION_DIR = '/opt/r20';
const STAMP = 'dist/.fiks-r20-build';

/** One sandbox container for a build: compiles dist once, then runs cases. */
export class R20Sandbox {
  private readonly session: string;
  private readonly box: DockerExecBackend;
  private n = 0;
  private built = false;

  constructor(
    readonly build: Build,
    hosts: string[],
    private readonly log: (s: string) => void = (s) => process.stderr.write(`${s}\n`),
  ) {
    this.session = mkdtempSync(join(tmpdir(), 'fiks-r20-session-'));
    const ca = createCertificateAuthority();
    try {
      const leaf = ca.issue(hosts.length ? hosts : ['api.figma.com']);
      writeFileSync(join(this.session, 'ca.pem'), ca.caCert);
      writeFileSync(join(this.session, 'leaf.key'), leaf.key);
      writeFileSync(join(this.session, 'leaf.pem'), leaf.cert);
    } finally {
      ca.dispose();
    }
    copyFileSync(join(HARNESS_DIR, 'sandbox', 'case-runner.mjs'), join(this.session, 'case-runner.mjs'));
    for (const f of ['ca.pem', 'leaf.key', 'leaf.pem', 'case-runner.mjs'])
      chmodSync(join(this.session, f), 0o644);
    chmodSync(this.session, 0o755);
    this.box = new DockerExecBackend({
      worktree: build.tree,
      image: build.image,
      mounts: [{ type: 'bind', source: this.session, target: SESSION_DIR, readonly: true }],
    });
  }

  get name(): string {
    return this.box.name;
  }

  /** `tsup` (the package's build without --dts) in the container, unless the stamp says it is current. */
  async ensureDist(): Promise<void> {
    if (this.built) return;
    const stampPath = join(this.build.tree, STAMP);
    const stamp = this.build.sha ?? '';
    if (
      !this.build.always &&
      stamp &&
      existsSync(join(this.build.tree, 'dist', 'bin.js')) &&
      existsSync(stampPath) &&
      readFileSync(stampPath, 'utf8') === stamp
    ) {
      this.built = true;
      return;
    }
    const pkg = JSON.parse(readFileSync(join(this.build.tree, 'package.json'), 'utf8')) as {
      version?: string;
    };
    this.log(`[r20] building dist in sandbox ${this.box.name} (${this.build.tree})`);
    const r = await this.box.exec('node_modules/.bin/tsup', [], {
      env: { ...SANDBOX_ENV, npm_package_version: pkg.version ?? '0.0.0' },
      timeoutMs: 10 * 60_000,
    });
    if (r.code !== 0 || !existsSync(join(this.build.tree, 'dist', 'bin.js'))) {
      throw new SetupError(
        `tsup failed in the sandbox (exit ${r.code}):\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`,
      );
    }
    if (stamp && !this.build.always) writeFileSync(stampPath, stamp);
    this.built = true;
  }

  /** One fresh server process for one case; returns what the in-sandbox runner saw. */
  async runCase(c: Case): Promise<CaseRun> {
    await this.ensureDist();
    const file = `case-${++this.n}.json`;
    writeFileSync(join(this.session, file), JSON.stringify(c));
    chmodSync(join(this.session, file), 0o644);
    const r = await this.box.exec(
      'node',
      [`${SESSION_DIR}/case-runner.mjs`, `${SESSION_DIR}/${file}`, SESSION_DIR],
      {
        timeoutMs: 180_000,
      },
    );
    const line = r.stdout.trim().split('\n').pop() ?? '';
    try {
      return JSON.parse(line) as CaseRun;
    } catch {
      throw new Error(
        `case runner failed (exit ${r.code}):\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`,
      );
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.box.cleanup();
    } finally {
      rmSync(this.session, { recursive: true, force: true });
    }
  }
}

/** Every upstream host named by these cases (the leaf certificate's names). */
export function caseHosts(cases: Case[]): string[] {
  return [...new Set(cases.flatMap((c) => c.upstream.map((x) => new URL(x.request.url).hostname)))].sort();
}

export function loadCase(path: string): Case {
  const c = JSON.parse(readFileSync(path, 'utf8')) as Case;
  if (c.tool !== 'download_figma_images')
    throw new Error(`${path}: tool ${c.tool} is not download_figma_images`);
  return c;
}
