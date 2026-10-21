// Command execution backends (PLAN.md Appendix, P1, P4): host or per-attempt container.

export interface ExecOptions {
  cwd?: string;
  /** The complete environment (backends never inherit the host env implicitly). */
  env?: Record<string, string>;
  input?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecBackend {
  exec(cmd: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  cleanup(): Promise<void>;
}

/** Hermetic local CI mirroring the target repo's `ci.yml`, run inside `image`. */
export type CiLocal = (
  worktree: string,
  image: string,
  extraChecks?: string[],
) => Promise<{ green: boolean; log: string }>;
