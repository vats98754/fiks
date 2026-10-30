// Where an exp run executes code from the checkout: the agent's allow-listed Bash, the gates, fiks's
// re-recording and the live scenarios.
//
//  - host: plain child processes with a scrubbed env {PATH, CI=1, HOME=<temp>} (tests, stubs);
//    fiks steps (re-record, scenarios) run in this process, as in `fiks repair`.
//  - docker: one SBX DockerExecBackend per run (--network none, read-only root, no capabilities,
//    env exactly SANDBOX_ENV), the shop-mcp sandbox image, the checkout at /opt/fiks/.work/shop-mcp
//    with its .git mounted read-only (so code that runs inside can never plant git hooks or config
//    that the host's git would later read), and the fiks-tools tree read-only at /opt/fiks. fiks
//    steps run there through SBX execFiks (env exactly FIKS_SANDBOX_ENV). Nothing that executes
//    checkout code is spawned on the host.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecBackend, ExecResult, RerecordProfile } from '@fiks/interfaces';
import { execEnv, hostBackend } from '@fiks/repair';
import {
  buildRepoImage,
  buildToolsImage,
  DockerExecBackend,
  docker,
  egressDenials,
  execFiks,
  imageDigest,
  SANDBOX_ENV,
  toolsMounts,
} from '@fiks/sandbox';
import { rerecordStale } from '../commands/rerecord-stale.ts';
import { runScenario } from '../commands/scenario.ts';
import { ROOT } from '../paths.ts';
import type { CallVerdict, SandboxKind } from './types.ts';

/** Where the CLI inside fiks-tools looks for the shop-mcp clone (`--shop-ref HEAD`). */
export const CONTAINER_SHOP = '/opt/fiks/.work/shop-mcp';
const CONTAINER_SCRATCH = '/tmp/fiks-exp';

export interface ScenarioOutcome {
  calls: CallVerdict[];
  output: string;
}

export interface ExpSandbox {
  readonly kind: SandboxKind;
  /** Host path of the checkout. */
  readonly worktree: string;
  /** The checkout as commands see it. */
  readonly workdir: string;
  readonly images: { repo: string | null; tools: string | null };
  /** A command in the checkout, scrubbed env. */
  exec(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** A scratch path for command output files (outside the checkout). */
  scratch(name: string): string;
  readScratch(path: string): Promise<string | undefined>;
  /** Backend for the agent's allow-listed Bash. */
  agentBackend(): ExecBackend;
  /** fiks re-records stale recordings (product behaviour); returns the repo-relative files written. */
  rerecord(
    fromCommit: string,
    profile: RerecordProfile,
  ): Promise<{ ok: boolean; files: string[]; output: string }>;
  /** A live scenario through the proxy against the checkout's server. */
  scenario(id: string): Promise<ScenarioOutcome>;
  /** Every refused outbound connection seen in command output so far. */
  egressDenials(): string[];
  cleanup(): Promise<void>;
}

const out = (r: ExecResult) => `${r.stdout}${r.stdout && r.stderr ? '\n' : ''}${r.stderr}`;

function verdictsOf(r: {
  calls: { tool: string; args: Record<string, unknown>; receipt?: { verdict: string } }[];
}) {
  return r.calls.map((c) => ({ tool: c.tool, args: c.args, verdict: c.receipt?.verdict ?? 'none' }));
}

export class HostExpSandbox implements ExpSandbox {
  readonly kind = 'host' as const;
  readonly workdir: string;
  readonly images = { repo: null, tools: null };
  private readonly tmp = mkdtempSync(join(tmpdir(), 'fiks-exp-host-'));
  private readonly backend = hostBackend();
  private readonly env = execEnv();
  private readonly denials: string[] = [];
  constructor(readonly worktree: string) {
    // vitest reports resolved paths (macOS /var -> /private/var).
    this.workdir = realpathSync(worktree);
  }
  async exec(cmd: string, args: string[], opts: { timeoutMs?: number } = {}) {
    const r = await this.backend.exec(cmd, args, {
      cwd: this.worktree,
      env: this.env,
      timeoutMs: opts.timeoutMs,
    });
    this.denials.push(...egressDenials(out(r)));
    return r;
  }
  scratch(name: string) {
    return join(this.tmp, name);
  }
  async readScratch(path: string) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  }
  agentBackend(): ExecBackend {
    return {
      exec: async (cmd, args, opts = {}) => {
        const r = await this.backend.exec(cmd, args, { ...opts, cwd: this.worktree, env: this.env });
        this.denials.push(...egressDenials(out(r)));
        return r;
      },
      cleanup: async () => {},
    };
  }
  async rerecord(fromCommit: string, profile: RerecordProfile) {
    try {
      const r = await rerecordStale(this.worktree, { fromCommit, profile });
      return {
        ok: true,
        files: r.map((x) => x.file),
        output: r.map((x) => `rerecorded ${x.file}`).join('\n'),
      };
    } catch (e) {
      return { ok: false, files: [], output: e instanceof Error ? e.message : String(e) };
    }
  }
  async scenario(id: string): Promise<ScenarioOutcome> {
    const r = await runScenario(id, {
      shopDir: this.worktree,
      traceDir: false,
      eventsPath: join(this.tmp, 'events.jsonl'),
    });
    return { calls: verdictsOf(r), output: '' };
  }
  egressDenials() {
    return [...this.denials];
  }
  async cleanup() {}
}

export interface DockerImages {
  repo: string;
  tools: string;
}

let imagesCache: Promise<DockerImages> | undefined;

/**
 * The shop-mcp sandbox image (lockfile of `seed-v1`) and a fiks-tools image. The code that runs
 * inside fiks-tools is rerecord-head and scenario. FIKS_TOOLS_IMAGE names the tools image (a run
 * records its digest); without it an existing `fiks-tools:<main12>` image is used, else one is built
 * from fiks `main`. FIKS_EXP_REPO_IMAGE overrides the repo image.
 */
export function dockerImages(shopRepo: string): Promise<DockerImages> {
  imagesCache ??= (async () => {
    const repo = process.env.FIKS_EXP_REPO_IMAGE
      ? await imageDigest(process.env.FIKS_EXP_REPO_IMAGE)
      : (await buildRepoImage({ repo: shopRepo, ref: 'seed-v1' })).digest;
    let tools: string;
    if (process.env.FIKS_TOOLS_IMAGE) tools = await imageDigest(process.env.FIKS_TOOLS_IMAGE);
    else {
      const main = execFileSync('git', ['rev-parse', 'main^{commit}'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      const tag = `fiks-tools:${main.slice(0, 12)}`;
      const have = await docker(['image', 'inspect', '--format', '{{.Id}}', tag]);
      if (have.code === 0) tools = await imageDigest(tag);
      else {
        try {
          tools = (await buildToolsImage({ ref: 'main' })).digest;
        } catch (e) {
          throw new Error(
            `no fiks-tools image for main ${main.slice(0, 12)} and the build failed (set FIKS_TOOLS_IMAGE to a fiks-tools image whose rerecord-head and scenario code equals main's): ${e instanceof Error ? e.message.split('\n').slice(0, 3).join(' ') : String(e)}`,
          );
        }
      }
    }
    return { repo, tools };
  })();
  imagesCache.catch(() => {
    imagesCache = undefined;
  });
  return imagesCache;
}

export class DockerExpSandbox implements ExpSandbox {
  readonly kind = 'docker' as const;
  readonly workdir = CONTAINER_SHOP;
  readonly worktree: string;
  private n = 0;
  private readonly denials: string[] = [];
  private constructor(
    private readonly backend: DockerExecBackend,
    readonly images: { repo: string; tools: string },
    private readonly egressLog: string,
  ) {
    this.worktree = backend.worktree;
  }

  static async create(worktree: string, images: DockerImages, egressLog: string): Promise<DockerExpSandbox> {
    const mounts = [
      ...(await toolsMounts(images.tools)),
      // After the worktree bind (DockerExecBackend mounts it first): .git is read-only inside.
      {
        type: 'bind' as const,
        source: join(worktree, '.git'),
        target: `${CONTAINER_SHOP}/.git`,
        readonly: true,
      },
    ];
    const backend = new DockerExecBackend({
      worktree,
      image: images.repo,
      workdir: CONTAINER_SHOP,
      mounts,
      egressLog,
    });
    const sb = new DockerExpSandbox(backend, images, egressLog);
    await backend.start();
    // HOME=/tmp in every sandbox env: the checkout's owner differs from the container user.
    const env = { ...SANDBOX_ENV };
    const r = await backend.exec(
      'sh',
      ['-c', `git config --global --add safe.directory '*' && mkdir -p ${CONTAINER_SCRATCH}`],
      {
        env,
        containerCwd: '/tmp',
      },
    );
    if (r.code !== 0) throw new Error(`sandbox setup failed: ${out(r)}`);
    return sb;
  }

  async exec(cmd: string, args: string[], opts: { timeoutMs?: number } = {}) {
    const r = await this.backend.exec(cmd, args, {
      cwd: this.worktree,
      env: { ...SANDBOX_ENV },
      timeoutMs: opts.timeoutMs,
    });
    this.denials.push(...egressDenials(out(r)));
    return r;
  }
  scratch(name: string) {
    return `${CONTAINER_SCRATCH}/${name}`;
  }
  async readScratch(path: string) {
    const r = await this.backend.exec('cat', [path], { env: { ...SANDBOX_ENV }, containerCwd: '/tmp' });
    return r.code === 0 ? r.stdout : undefined;
  }
  agentBackend(): ExecBackend {
    return {
      exec: async (cmd, args, opts = {}) => {
        const r = await this.backend.exec(cmd, args, {
          cwd: opts.cwd ?? this.worktree,
          input: opts.input,
          timeoutMs: opts.timeoutMs,
          env: { ...SANDBOX_ENV },
        });
        this.denials.push(...egressDenials(out(r)));
        return r;
      },
      cleanup: async () => {},
    };
  }
  async rerecord(fromCommit: string, profile: RerecordProfile) {
    const log = `${CONTAINER_SCRATCH}/rerecord-${++this.n}.jsonl`;
    const r = await execFiks(
      this.backend,
      [
        'rerecord-head',
        '--require-sandbox',
        '--worktree',
        CONTAINER_SHOP,
        '--profile',
        JSON.stringify(profile),
        '--from',
        fromCommit,
        '--log',
        log,
        '--json',
      ],
      { timeoutMs: 20 * 60_000 },
    );
    this.denials.push(...egressDenials(out(r)));
    let parsed: { log?: { files?: { path: string; mode: string; outcome: string }[] }; manifest?: string } =
      {};
    try {
      parsed = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '');
    } catch {
      return { ok: false, files: [], output: out(r) };
    }
    // Only product re-recordings (stale, kept) are used; a per-check overlay is undone at once.
    if (parsed.manifest)
      await execFiks(this.backend, ['rerecord-head', '--require-sandbox', '--restore', parsed.manifest]);
    const files = (parsed.log?.files ?? [])
      .filter((f) => f.mode === 'stale' && f.outcome === 'rerecorded')
      .map((f) => f.path.replace(/\.json$/, '.rerecorded.json'));
    return { ok: r.code === 0, files, output: out(r) };
  }
  async scenario(id: string): Promise<ScenarioOutcome> {
    if (!/^[\w-]+$/.test(id)) throw new Error(`bad scenario id ${id}`);
    const r = await execFiks(this.backend, ['scenario', id, '--json', '--shop-ref', 'HEAD'], {
      timeoutMs: 10 * 60_000,
    });
    this.denials.push(...egressDenials(out(r)));
    if (r.code !== 0)
      throw new Error(`scenario ${id} in the sandbox exited ${r.code}: ${out(r).slice(-1500)}`);
    const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as Parameters<typeof verdictsOf>[0];
    return { calls: verdictsOf(json), output: r.stderr };
  }
  egressDenials() {
    // The SBX egress log (one line per denial) plus what this process saw.
    let logged: string[] = [];
    try {
      logged = readFileSync(this.egressLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { line: string }).line);
    } catch {}
    return [...new Set([...logged, ...this.denials])];
  }
  async cleanup() {
    try {
      await this.backend.cleanup();
    } catch (e) {
      // SBX restores the node_modules link after removing the container; the checkout is
      // disposable, so a mountpoint Docker has not released yet is tolerated.
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw e;
    }
  }
}

export async function createSandbox(
  kind: SandboxKind,
  worktree: string,
  opts: { shopRepo: string; egressLog?: string },
): Promise<ExpSandbox> {
  if (kind === 'host') return new HostExpSandbox(worktree);
  const images = await dockerImages(opts.shopRepo);
  const egressLog = opts.egressLog ?? join(mkdtempSync(join(tmpdir(), 'fiks-exp-egress-')), 'egress.jsonl');
  writeFileSync(egressLog, '', { flag: 'a' });
  return DockerExpSandbox.create(worktree, images, egressLog);
}
