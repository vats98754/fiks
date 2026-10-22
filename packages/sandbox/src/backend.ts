// DockerExecBackend (PLAN P1, Appendix `ExecBackend`): one long-lived container per attempt, every
// command run through `docker exec` with a complete, scrubbed environment.
//
// Container: --network none (loopback only), read-only root filesystem, tmpfs /tmp (= HOME), no
// capabilities, no-new-privileges, memory/cpu/pids limits (MEMORY.md). The worktree is bind-mounted
// at `workdir`; its node_modules is a per-container volume copied from the image's Linux install
// (the host's node_modules symlink, which points at macOS binaries, is taken out of the worktree
// while the container exists and put back by cleanup()). The git shim is first on PATH.
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ExecBackend, ExecOptions, ExecResult } from '@fiks/interfaces';
import { docker, dockerOk } from './docker.ts';

export const SANDBOX_PATH = '/opt/fiks-shim:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
/** P1: the agent/tool environment inside a per-attempt container. */
export const SANDBOX_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: SANDBOX_PATH,
  CI: '1',
  HOME: '/tmp',
});
/** In-container log of blocked pushes (written by the image's git shim; /tmp is the tmpfs HOME). */
export const CONTAINER_PUSH_LOG = '/tmp/.fiks-git-push.log';

export interface Limits {
  memory: string;
  cpus: string;
  pids: number;
  tmpfs: string;
}
/** Per-container limits; Docker Desktop has 6 GB in total (MEMORY.md). */
export const DEFAULT_LIMITS: Limits = { memory: '2g', cpus: '2', pids: 1024, tmpfs: '1g' };

export interface Mount {
  type: 'bind' | 'volume';
  source: string;
  target: string;
  readonly?: boolean;
  /** Volume mounts only: a path inside the volume. */
  subpath?: string;
}

export interface DockerExecBackendOptions {
  /** Host path of the worktree (bind-mounted read-write unless `readonlyWorktree`). */
  worktree: string;
  /** Image reference, preferably the pinned `sha256:` digest. */
  image: string;
  /** Where the worktree appears in the container (default /work). */
  workdir?: string;
  /** 'image' (default): node_modules = a per-container copy of `nodeModulesFrom` in the image. */
  nodeModules?: 'image' | 'none';
  nodeModulesFrom?: string;
  /** Default environment for exec() (default SANDBOX_ENV). */
  env?: Record<string, string>;
  mounts?: Mount[];
  limits?: Partial<Limits>;
  readonlyWorktree?: boolean;
  /** JSONL file on the host: one line per denied egress attempt seen in a command's output. */
  egressLog?: string;
  name?: string;
}

/** Variable names that never enter a sandbox, whatever a caller passes. */
const SECRET_NAME =
  /TOKEN|SECRET|PASSW|API_?KEY|ANTHROPIC|CLAUDE|GITHUB|^GH_|AWS_|CANARY|SSH_AUTH|NPM_CONFIG_/i;

export function assertSafeEnv(env: Record<string, string>): void {
  const bad = Object.keys(env).filter((k) => SECRET_NAME.test(k));
  if (bad.length) throw new Error(`refusing to pass ${bad.join(', ')} into a sandbox container`);
}

/** Output signatures of a connection the sandbox refused (no DNS, no route). */
export const EGRESS_DENIAL =
  /(Could not resolve host|getaddrinfo (?:EAI_AGAIN|ENOTFOUND)|\b(?:EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH)\b|Network is unreachable|Temporary failure in name resolution)/;

export function egressDenials(output: string): string[] {
  return output.split('\n').filter((l) => EGRESS_DENIAL.test(l));
}

export interface SandboxExecOptions extends ExecOptions {
  /** A working directory given as a container path (instead of a host path in the worktree). */
  containerCwd?: string;
}

export interface PushRecord {
  at: string;
  cwd: string;
  reason: string;
  argv: string[];
}

export function parsePushLog(text: string): PushRecord[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as PushRecord);
}

export class DockerExecBackend implements ExecBackend {
  readonly name: string;
  readonly worktree: string;
  readonly workdir: string;
  readonly image: string;
  readonly mounts: Mount[];
  private readonly opts: DockerExecBackendOptions;
  private readonly limits: Limits;
  private started?: Promise<void>;
  private volume?: string;
  private restoreLink?: string;
  private ownMountpoint = false;
  private closed = false;

  constructor(opts: DockerExecBackendOptions) {
    this.opts = opts;
    this.worktree = realpathSync(resolve(opts.worktree));
    this.workdir = opts.workdir ?? '/work';
    this.image = opts.image;
    this.mounts = opts.mounts ?? [];
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.name = opts.name ?? `fiks-sbx-${randomBytes(5).toString('hex')}`;
    assertSafeEnv(opts.env ?? SANDBOX_ENV);
  }

  /** Host path inside the worktree -> container path (throws for anything outside it). */
  containerPath(hostPath: string): string {
    const abs = isAbsolute(hostPath) ? hostPath : join(this.worktree, hostPath);
    let real = abs;
    try {
      real = realpathSync(abs);
    } catch {
      // Not created yet: resolve lexically.
    }
    const rel = relative(this.worktree, real);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`${hostPath} is outside the sandboxed worktree ${this.worktree}`);
    }
    return rel ? `${this.workdir}/${rel.split(sep).join('/')}` : this.workdir;
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error(`sandbox ${this.name} was cleaned up`));
    this.started ??= this.doStart();
    return this.started;
  }

  private async doStart(): Promise<void> {
    const nm = join(this.worktree, 'node_modules');
    const mounts: string[] = [
      '--mount',
      `type=bind,src=${this.worktree},dst=${this.workdir}${this.opts.readonlyWorktree ? ',readonly' : ''}`,
    ];
    if ((this.opts.nodeModules ?? 'image') === 'image') {
      // Take the host symlink out of the worktree so the container sees a real directory there.
      try {
        if (lstatSync(nm).isSymbolicLink()) {
          this.restoreLink = readlinkSync(nm);
          unlinkSync(nm); // the link only, never what it points at
          this.ownMountpoint = true;
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        this.ownMountpoint = true;
      }
      this.volume = `${this.name}-nm`;
      await dockerOk(['volume', 'create', '--label', 'fiks.sandbox=1', this.volume]);
      const from = this.opts.nodeModulesFrom ?? '/work/node_modules';
      await dockerOk(
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--mount',
          `type=volume,src=${this.volume},dst=/fiks-nm`,
          '--entrypoint',
          'sh',
          this.image,
          '-c',
          `cp -a ${shq(from)}/. /fiks-nm/`,
        ],
        { timeoutMs: 10 * 60_000 },
      );
      mounts.push('--mount', `type=volume,src=${this.volume},dst=${this.workdir}/node_modules`);
    }
    for (const m of this.mounts) mounts.push('--mount', mountSpec(m));
    const l = this.limits;
    await dockerOk(
      [
        'run',
        '--detach',
        '--name',
        this.name,
        '--label',
        'fiks.sandbox=1',
        '--network',
        'none',
        '--read-only',
        '--tmpfs',
        `/tmp:rw,exec,nosuid,nodev,size=${l.tmpfs}`,
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        l.memory,
        '--memory-swap',
        l.memory,
        '--cpus',
        l.cpus,
        '--pids-limit',
        String(l.pids),
        '--init',
        '--workdir',
        this.workdir,
        ...mounts,
        '--entrypoint',
        'sleep',
        this.image,
        'infinity',
      ],
      { timeoutMs: 5 * 60_000 },
    );
  }

  async exec(cmd: string, args: string[], opts: SandboxExecOptions = {}): Promise<ExecResult> {
    await this.start();
    const env = opts.env ?? this.opts.env ?? SANDBOX_ENV;
    assertSafeEnv(env);
    const cwd = opts.containerCwd ?? (opts.cwd ? this.containerPath(opts.cwd) : this.workdir);
    const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    // `env -i` gives the command exactly `env`: nothing from the image or from Docker (HOSTNAME).
    const inner = ['env', '-i', ...envArgs];
    if (opts.timeoutMs !== undefined) {
      inner.push('timeout', '-s', 'KILL', `${Math.max(1, Math.ceil(opts.timeoutMs / 1000))}s`);
    }
    const r = await docker(['exec', '-i', '-w', cwd, this.name, ...inner, cmd, ...args], {
      input: opts.input,
      timeoutMs: opts.timeoutMs === undefined ? undefined : opts.timeoutMs + 30_000,
    });
    if (this.opts.egressLog) logEgress(this.opts.egressLog, this.name, [cmd, ...args], r);
    return r;
  }

  /** Pushes the image's git shim recorded (and refused) in this container. */
  async pushAttempts(): Promise<PushRecord[]> {
    await this.start();
    const r = await docker(['exec', this.name, 'cat', CONTAINER_PUSH_LOG]);
    return r.code === 0 ? parsePushLog(r.stdout) : [];
  }

  async cleanup(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.started) {
      await this.started.catch(() => undefined);
      await docker(['rm', '--force', '--volumes', this.name]);
    }
    if (this.volume) await docker(['volume', 'rm', '--force', this.volume]);
    const nm = join(this.worktree, 'node_modules');
    if (this.ownMountpoint) {
      try {
        rmdirSync(nm); // the empty mountpoint Docker left in the worktree
      } catch {
        // Already gone (or not empty: then it is not ours to remove).
      }
    }
    if (this.restoreLink !== undefined) symlinkSync(this.restoreLink, nm);
  }
}

export function mountSpec(m: Mount): string {
  let s = `type=${m.type},src=${m.source},dst=${m.target}`;
  if (m.subpath) s += `,volume-subpath=${m.subpath}`;
  if (m.readonly) s += ',readonly';
  return s;
}

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function logEgress(file: string, container: string, argv: string[], r: ExecResult): void {
  const lines = egressDenials(`${r.stdout}\n${r.stderr}`);
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  const at = new Date().toISOString();
  for (const line of lines.slice(0, 20)) {
    appendFileSync(
      file,
      `${JSON.stringify({ at, container, argv: argv.slice(0, 8), denied: true, line: line.slice(0, 500) })}\n`,
    );
  }
}
