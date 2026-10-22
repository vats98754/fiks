// A scripted grading sandbox for unit tests: it records every exec (command, argv, env) and answers
// from a script instead of running anything, so accept() and grade() orchestration (call counts,
// caching, the execFiks route, the accept rule) is tested without Docker. Real containers are
// exercised by test/e2e.test.ts.
import type { ExecResult, RerecordLog } from '@fiks/interfaces';
import { FIKS_MAIN, FIKS_TSX, type Mount, type SandboxExecOptions } from '@fiks/sandbox';
import { OBSERVE_SENTINEL, type ObserveResult } from '../../src/observe.ts';
import type { GradingSandbox, SandboxFactory } from '../../src/sandbox.ts';

export interface ExecCall {
  sandbox: string;
  worktree: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  input?: string;
}

export interface VitestReportFile {
  name: string;
  status: 'passed' | 'failed';
  message?: string;
  assertionResults: { status: 'passed' | 'failed' }[];
}

export interface Script {
  typecheck?: (worktree: string) => number;
  lint?: (worktree: string) => number;
  /** vitest over `files` ([] = the whole suite) -> per-file results. */
  vitest?: (files: string[], worktree: string, env: Record<string, string>) => VitestReportFile[];
  /** fs-read log contents (container paths) for a base profile run of `files`. */
  reads?: (files: string[]) => string[];
  rerecord?: (args: string[], worktree: string) => { code: number; log: RerecordLog };
  observe?: (input: string, worktree: string) => ObserveResult;
}

export const passed = (name: string): VitestReportFile => ({
  name: `/work/${name}`,
  status: 'passed',
  assertionResults: [{ status: 'passed' }],
});

export const failed = (name: string): VitestReportFile => ({
  name: `/work/${name}`,
  status: 'failed',
  assertionResults: [{ status: 'failed' }],
});

/** What vitest reports for a file that does not compile (no test ran). */
export const broken = (name: string): VitestReportFile => ({
  name: `/work/${name}`,
  status: 'failed',
  message: 'Transform failed with 1 error: Expected ";" but found "{"',
  assertionResults: [],
});

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

export function scriptedSandbox(script: Script, calls: ExecCall[]): SandboxFactory {
  let n = 0;
  return async (worktree: string, mounts: Mount[]) => {
    const files = new Map<string, string>();
    const name = `fake-${n++}`;
    const sb: GradingSandbox = {
      name,
      // execFiks requires a read-only fiks-tools mount.
      mounts: [
        { type: 'volume', source: 'fiks-tools-fake', target: '/opt/fiks/packages', readonly: true },
        ...mounts,
      ],
      async exec(cmd: string, args: string[], opts: SandboxExecOptions = {}): Promise<ExecResult> {
        calls.push({ sandbox: name, worktree, cmd, args, env: opts.env, input: opts.input });
        const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
        if (cmd === 'mkdir') return ok();
        if (cmd === 'cat') {
          const f = files.get(args[0] as string);
          return f === undefined ? { code: 1, stdout: '', stderr: 'no such file' } : ok(f);
        }
        if (cmd === 'pnpm' && args.includes('typecheck'))
          return { code: script.typecheck?.(worktree) ?? 0, stdout: '', stderr: '' };
        if (cmd === 'pnpm' && args.includes('lint'))
          return { code: script.lint?.(worktree) ?? 0, stdout: '', stderr: '' };
        if (cmd === 'node_modules/.bin/vitest') {
          const out = (args.find((a) => a.startsWith('--outputFile=')) ?? '').slice('--outputFile='.length);
          const tests = args.filter((a) => a !== 'run' && !a.startsWith('--'));
          const env = opts.env ?? {};
          const results =
            script.vitest?.(tests, worktree, env) ??
            (tests.length
              ? tests.map(passed)
              : [passed('test/server.test.ts'), passed('test/fiks/traces.test.ts')]);
          files.set(out, JSON.stringify({ testResults: results }));
          if (env.FIKS_FS_READ_LOG)
            files.set(env.FIKS_FS_READ_LOG, `${(script.reads?.(tests) ?? []).join('\n')}\n`);
          const fail = results.some((r) => r.status === 'failed');
          return { code: fail ? 1 : 0, stdout: '', stderr: '' };
        }
        if (cmd === FIKS_TSX && args[0] === FIKS_MAIN) {
          const argv = args.slice(1);
          if (argv[0] === 'rerecord-head' && argv.includes('--restore')) return ok('{"restored":[]}');
          if (argv[0] === 'rerecord-head') {
            const recs = (flag(argv, '--recordings') ?? '').split(',').filter(Boolean);
            const r = script.rerecord?.(argv, worktree) ?? {
              code: 0,
              log: {
                profile: JSON.parse(flag(argv, '--profile') ?? '{}'),
                head: 'h',
                fromCommit: flag(argv, '--from') ?? '',
                check: 'accept',
                files: recs.map((path) => ({
                  path,
                  mode: 'overlay' as const,
                  requestKeysBefore: [],
                  requestKeysAfter: [],
                  outcome: 'unchanged' as const,
                })),
              },
            };
            files.set(flag(argv, '--log') ?? '', `${JSON.stringify(r.log)}\n`);
            return { code: r.code, stdout: `${JSON.stringify({ log: r.log })}\n`, stderr: '' };
          }
          if (argv[0] === 'grade' && argv.includes('--observe')) {
            const obs = script.observe?.(opts.input ?? '', worktree);
            if (!obs) return { code: 1, stdout: '', stderr: 'no observation scripted' };
            return ok(`server noise\n${OBSERVE_SENTINEL}${JSON.stringify(obs)}\n`);
          }
        }
        return { code: 127, stdout: '', stderr: `fake sandbox: unscripted ${cmd} ${args.join(' ')}` };
      },
      async cleanup() {},
    };
    return sb;
  };
}
