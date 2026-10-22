// Thin wrappers around the docker CLI. The CLI itself gets a scrubbed environment: only what it needs
// to find the daemon, so no host secret can reach a container through `docker run -e` by accident.
import { spawn, spawnSync } from 'node:child_process';

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DOCKER_VARS = [
  'PATH',
  'HOME',
  'USER',
  'TMPDIR',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
  'DOCKER_BUILDKIT',
  'BUILDX_CONFIG',
];

/** The environment the docker CLI runs with: daemon location only, never tokens or keys. */
export function dockerCliEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of DOCKER_VARS) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export interface DockerOptions {
  input?: string;
  timeoutMs?: number;
  /** Mirror output to this process's stderr while it runs (long builds). */
  echo?: boolean;
  cwd?: string;
}

/** Runs `docker <args>`; never throws on a non-zero exit (the caller reads `code`). */
export function docker(args: string[], opts: DockerOptions = {}): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      env: dockerCliEnv(),
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, opts.timeoutMs);
    child.stdout.on('data', (b: Buffer) => {
      out.push(b);
      if (opts.echo) process.stderr.write(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      err.push(b);
      if (opts.echo) process.stderr.write(b);
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      let stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) stderr += `\n[fiks-sandbox] timed out after ${opts.timeoutMs} ms`;
      resolve({
        code: code ?? (signal ? 128 + 9 : 1),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr,
      });
    });
    child.stdin.end(opts.input ?? '');
  });
}

/** Like `docker`, but throws with the command's stderr when it exits non-zero. */
export async function dockerOk(args: string[], opts: DockerOptions = {}): Promise<string> {
  const r = await docker(args, opts);
  if (r.code !== 0) {
    // BuildKit repeats the Dockerfile in its error; the tool's own error lines say what broke.
    const key = r.stderr
      .split('\n')
      .filter((l) => /ERR_|Error:|error:|ENOENT|EACCES/.test(l))
      .slice(0, 12)
      .join('\n');
    const tail = r.stderr.trim().slice(-1500);
    throw new Error(
      `docker ${args.slice(0, 3).join(' ')} … exited ${r.code}:\n${key ? `${key}\n---\n` : ''}${tail}`,
    );
  }
  return r.stdout;
}

export function dockerSync(args: string[]): CmdResult {
  const r = spawnSync('docker', args, { env: dockerCliEnv(), encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Throws a clear error when the docker daemon is not reachable (Docker Desktop not running). */
export function assertDocker(): void {
  const r = dockerSync(['info', '--format', '{{.ServerVersion}}']);
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error(`Docker is not available (start Docker Desktop, PLAN 8.0-1): ${r.stderr.trim()}`);
  }
}

/** The local image id (`sha256:<config digest>`), which runs pin and record in meta.json. */
export async function imageDigest(ref: string): Promise<string> {
  return (await dockerOk(['image', 'inspect', '--format', '{{.Id}}', ref])).trim();
}

export async function imageLabels(ref: string): Promise<Record<string, string>> {
  const out = await dockerOk(['image', 'inspect', '--format', '{{json .Config.Labels}}', ref]);
  return (JSON.parse(out.trim()) ?? {}) as Record<string, string>;
}
