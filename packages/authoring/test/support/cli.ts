// Runs the fiks CLI (tsx packages/cli/src/main.ts) as a subprocess, as `pnpm fiks` does.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
export const STUBS = join(ROOT, 'packages/authoring/test/stubs');

export function fiks(args: string[], env: NodeJS.ProcessEnv = {}): { code: number; out: string } {
  const r = spawnSync(
    join(ROOT, 'node_modules/.bin/tsx'),
    [join(ROOT, 'packages/cli/src/main.ts'), ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: withoutForbid({ ...process.env, ...env }),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60_000,
    },
  );
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Stub runs make no LLM call, but agentSession still refuses under FIKS_LLM_FORBID=1. */
function withoutForbid(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  delete out.FIKS_LLM_FORBID;
  return out;
}
