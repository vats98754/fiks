// A scripted stand-in for the per-attempt container (unit tests that need no Docker): it answers
// the fiks commands and CI steps an arm sends with fixed verdicts and records every call.
import type { ExecBackend, ExecResult } from '@fiks/interfaces';
import type { ArmSandbox, SandboxCall } from '../../src/sandbox.ts';

export interface FakeSandboxOptions {
  worktree: string;
  /** Verdict of each CI / pre-gate step (default green). */
  green?: (call: SandboxCall, n: number) => boolean;
  /** fiks-iv verdict (default pass); the failing property id is printed. */
  ivPass?: boolean;
  ivProperty?: string;
  calls?: SandboxCall[];
}

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });

export function fakeSandbox(o: FakeSandboxOptions): ArmSandbox & { calls: SandboxCall[] } {
  const calls = o.calls ?? [];
  let n = 0;
  const exec = async (cmd: string, args: string[]): Promise<ExecResult> => {
    const call: SandboxCall = { cmd, args, via: 'exec' };
    calls.push(call);
    if (cmd === 'bash') {
      const green = o.green?.(call, n++) ?? true;
      return green ? ok('ok') : { code: 1, stdout: '', stderr: 'step failed' };
    }
    return ok('');
  };
  const sb: ArmSandbox & { calls: SandboxCall[] } = {
    worktree: o.worktree,
    workdir: '/work',
    imageDigest: 'sha256:fake',
    calls,
    exec,
    async fiks(argv) {
      calls.push({ cmd: 'execFiks', args: argv, via: 'execFiks' });
      if (argv.includes('--restore')) return ok('');
      const sep = argv.indexOf('--');
      if (sep >= 0 && argv.slice(sep).some((a) => a.endsWith('iv-cli.ts'))) {
        return o.ivPass === false
          ? { code: 1, stdout: `IV FAIL ${o.ivProperty ?? 'p/x'}: planted\n`, stderr: '' }
          : ok('IV PASS (1 checked)\n');
      }
      return ok(JSON.stringify({ log: { files: [] } }));
    },
    agentBackend(): ExecBackend {
      return { exec: (cmd, args) => exec(cmd, args), cleanup: async () => {} };
    },
    async stage(name) {
      return `/tmp/fiks-arms/${name}`;
    },
    async cleanup() {},
  };
  return sb;
}
