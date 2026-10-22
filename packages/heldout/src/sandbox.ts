// The grading container (PLAN P1 round 6, 5.8): candidate code (the patched head's server, its
// tests, the agent's tests) runs only here. One container per head: the head's clone is mounted at
// /work with the repo image's Linux node_modules, the fiks-tools tree read-only at /opt/fiks (the
// fiks CLI runs from it through SBX execFiks: --network none, env exactly FIKS_SANDBOX_ENV), and
// the drift's injector rule read-only at /opt/heldout-rule. Nothing of the host's environment,
// home directory or network is visible.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ExecResult, InjectorRule } from '@fiks/interfaces';
import {
  DockerExecBackend,
  execFiks,
  FIKS_SANDBOX_ENV,
  type Mount,
  SANDBOX_ENV,
  type SandboxExecOptions,
  toolsMounts,
} from '@fiks/sandbox';

export const WORKDIR = '/work';
/** Container scratch (on the /tmp tmpfs). */
export const SCRATCH = '/tmp/fiks-grade';
export const RULE_DIR = '/opt/heldout-rule';
export const FS_READ_LOG_PRELOAD_IN_TOOLS = '/opt/fiks/packages/repro/src/fs-read-log.cjs';

/** What the grader needs of a container (DockerExecBackend has it; tests pass a spy). */
export interface GradingSandbox {
  name: string;
  mounts: Mount[];
  exec(cmd: string, args: string[], opts?: SandboxExecOptions): Promise<ExecResult>;
  cleanup(): Promise<void>;
}

/** Opens a grading container on a host worktree with extra mounts. */
export type SandboxFactory = (worktree: string, mounts: Mount[]) => Promise<GradingSandbox>;

export interface DockerSandboxOptions {
  /** The target repo's sandbox image (SBX buildRepoImage), preferably by digest. */
  repoImage: string;
  /** The fiks-tools image (SBX buildToolsImage). */
  toolsImage: string;
  /** 'test' accepts a test-only tools image (built with --apply-fragments; never for runs). */
  purpose?: 'run' | 'test';
}

export function dockerSandboxFactory(opts: DockerSandboxOptions): SandboxFactory {
  return async (worktree, mounts) => {
    const tools = await toolsMounts(opts.toolsImage, { purpose: opts.purpose ?? 'run' });
    return new DockerExecBackend({ worktree, image: opts.repoImage, mounts: [...tools, ...mounts] });
  };
}

/** The fiks CLI inside the container (SBX execFiks: /opt/fiks tsx main.ts, FIKS_SANDBOX_ENV). */
export function fiksIn(
  sb: GradingSandbox,
  argv: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return execFiks(sb as unknown as DockerExecBackend, argv, opts);
}

/** A plain command in the container at the worktree root (or `cwd`), with the sandbox env. */
export function run(
  sb: GradingSandbox,
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number; cwd?: string } = {},
): Promise<ExecResult> {
  return sb.exec(cmd, args, {
    env: { ...SANDBOX_ENV, ...(opts.env ?? {}) },
    containerCwd: opts.cwd ?? WORKDIR,
    timeoutMs: opts.timeoutMs,
  });
}

export async function readIn(sb: GradingSandbox, path: string): Promise<string | undefined> {
  const r = await run(sb, 'cat', [path]);
  return r.code === 0 ? r.stdout : undefined;
}

/**
 * The rule as the container sees it: a host directory with the transform module and a LoadedRule
 * JSON whose transformPath is the container path, mounted read-only at RULE_DIR.
 */
export function ruleMount(rule: InjectorRule & { transformPath: string }): {
  mount: Mount;
  rulePath: string;
  containerRule: InjectorRule & { transformPath: string; file: string };
} {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-heldout-rule-'));
  const transform = basename(rule.transformPath);
  mkdirSync(dir, { recursive: true });
  copyFileSync(rule.transformPath, join(dir, transform));
  const containerRule = {
    id: rule.id,
    domain: rule.domain,
    match: rule.match,
    transform: rule.transform,
    clockFrozen: rule.clockFrozen,
    hash: rule.hash,
    file: '',
    transformPath: `${RULE_DIR}/${transform}`,
  };
  writeFileSync(join(dir, 'rule.json'), `${JSON.stringify(containerRule)}\n`);
  return {
    mount: { type: 'bind', source: dir, target: RULE_DIR, readonly: true },
    rulePath: `${RULE_DIR}/rule.json`,
    containerRule,
  };
}

export { FIKS_SANDBOX_ENV };

/** The target repo's sandbox image at `ref` (SBX buildRepoImage; cached by Docker on its lockfile). */
export async function repoImageFor(repoDir: string, ref: string): Promise<string> {
  const { buildRepoImage } = await import('@fiks/sandbox');
  return (await buildRepoImage({ repo: repoDir, ref })).digest;
}
