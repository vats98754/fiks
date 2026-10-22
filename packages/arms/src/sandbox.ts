// The per-attempt container every arm runs its agent Bash, re-recording and checks in (PLAN P1,
// round 6): one DockerExecBackend per attempt with the target repo's sandbox image, the worktree
// at /work (Linux node_modules from the image) and the fiks-tools tree mounted read-only at
// /opt/fiks. fiks commands (rerecord-head, fiks-iv behind it) run only through SBX `execFiks`
// (env exactly FIKS_SANDBOX_ENV, --network none); nothing an arm runs that executes candidate code
// (re-recording, the server, the suite, CI) is ever spawned on the host.
import type { ExecBackend, ExecOptions, ExecResult } from '@fiks/interfaces';
import {
  DockerExecBackend,
  execFiks,
  FIKS_SANDBOX_ENV,
  SANDBOX_ENV,
  type SandboxExecOptions,
  toolsMounts,
} from '@fiks/sandbox';

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const CONTAINER_WORKDIR = '/work';
/** fiks-owned scratch inside the container (tmpfs; never in the worktree). */
export const CONTAINER_SCRATCH = '/tmp/fiks-arms';

/** One recorded call into the container (for spies and the attempt log). */
export interface SandboxCall {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  via: 'exec' | 'execFiks';
}

export interface ArmSandbox {
  /** Host path of the attempt worktree (mounted at /work). */
  readonly worktree: string;
  /** Container path of the worktree. */
  readonly workdir: string;
  /** Repo image digest (AttemptRecord.imageDigest), when known. */
  readonly imageDigest: string | null;
  /** Raw command in the container (CI steps, checks). */
  exec(cmd: string, args: string[], opts?: SandboxExecOptions): Promise<ExecResult>;
  /** The fiks CLI in the container through SBX execFiks (env FIKS_SANDBOX_ENV). */
  fiks(argv: string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Backend for the agent's allow-listed Bash: the container, with the scrubbed SANDBOX_ENV. */
  agentBackend(): ExecBackend;
  /** Writes a fiks-owned file into the container's scratch; returns its container path. */
  stage(name: string, content: string | Buffer): Promise<string>;
  cleanup(): Promise<void>;
}

export interface DockerArmSandboxOptions {
  worktree: string;
  /** Target repo sandbox image (SBX build.ts), preferably a sha256 digest. */
  image: string;
  /** fiks-tools image (SBX build-tools.ts). */
  toolsImage: string;
  /** 'test' accepts a test-only tools image (built with --apply-fragments); runs use 'run'. */
  toolsPurpose?: 'run' | 'test';
  /** Called for every command sent into the container (tests spy here). */
  onCall?: (c: SandboxCall) => void;
  /** JSONL egress-denial log (SBX). */
  egressLog?: string;
}

export class DockerArmSandbox implements ArmSandbox {
  readonly worktree: string;
  readonly workdir = CONTAINER_WORKDIR;
  readonly imageDigest: string | null;
  private constructor(
    private readonly backend: DockerExecBackend,
    private readonly opts: DockerArmSandboxOptions,
  ) {
    this.worktree = backend.worktree;
    this.imageDigest = opts.image.startsWith('sha256:') ? opts.image : null;
  }

  static async create(opts: DockerArmSandboxOptions): Promise<DockerArmSandbox> {
    const mounts = await toolsMounts(opts.toolsImage, { purpose: opts.toolsPurpose ?? 'run' });
    const backend = new DockerExecBackend({
      worktree: opts.worktree,
      image: opts.image,
      workdir: CONTAINER_WORKDIR,
      mounts,
      egressLog: opts.egressLog,
    });
    const sb = new DockerArmSandbox(backend, opts);
    await backend.start();
    // HOME=/tmp in every sandbox env: mark the mounted worktree safe for git (owner differs).
    await sb.exec('git', ['config', '--global', '--add', 'safe.directory', '*'], { env: { ...SANDBOX_ENV } });
    await sb.exec('mkdir', ['-p', CONTAINER_SCRATCH], { env: { ...SANDBOX_ENV } });
    return sb;
  }

  exec(cmd: string, args: string[], opts: SandboxExecOptions = {}): Promise<ExecResult> {
    this.opts.onCall?.({ cmd, args, env: opts.env, cwd: opts.containerCwd ?? opts.cwd, via: 'exec' });
    return this.backend.exec(cmd, args, opts);
  }

  fiks(argv: string[], opts: { timeoutMs?: number } = {}): Promise<ExecResult> {
    this.opts.onCall?.({ cmd: 'execFiks', args: argv, env: { ...FIKS_SANDBOX_ENV }, via: 'execFiks' });
    return execFiks(this.backend, argv, { timeoutMs: opts.timeoutMs ?? 30 * 60_000 });
  }

  agentBackend(): ExecBackend {
    return {
      exec: (cmd: string, args: string[], opts: ExecOptions = {}) =>
        this.exec(cmd, args, {
          cwd: opts.cwd,
          input: opts.input,
          timeoutMs: opts.timeoutMs,
          env: { ...SANDBOX_ENV },
        }),
      cleanup: async () => {},
    };
  }

  async stage(name: string, content: string | Buffer): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`stage: bad file name ${name}`);
    const path = `${CONTAINER_SCRATCH}/${name}`;
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    const r = await this.exec('sh', ['-c', `cat > ${shq(path)}`], { input: text, env: { ...SANDBOX_ENV } });
    if (r.code !== 0) throw new Error(`stage ${name}: ${r.stderr}`);
    return path;
  }

  cleanup(): Promise<void> {
    return this.backend.cleanup();
  }
}
