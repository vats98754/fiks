// Shared by the ORCH arm tests. Container tests are opt-in (FIKS_ORCH_E2E=1, like SBX's
// FIKS_SANDBOX_E2E): each attempt starts a per-attempt container and runs the shop-mcp suite in it
// several times (minutes per attempt). They use a test-only fiks-tools image of this checkout's
// HEAD (FIKS_TOOLS_IMAGE overrides): ORCH's own bootstrap (30-injector.ts) must be inside it.
import '../../../src/bootstrap/00-shop.ts';
import '../../../src/bootstrap/10-tracker.ts';
import '../../../src/bootstrap/20-sandbox.ts';
import '../../../src/bootstrap/30-injector.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildToolsImage } from '@fiks/sandbox';
import { ROOT } from '../../../src/paths.ts';

export const E2E = process.env.FIKS_ORCH_E2E === '1';
export const TSX = join(ROOT, 'node_modules/.bin/tsx');
export const MAIN = join(ROOT, 'packages/cli/src/main.ts');
export const ORACLES = join(ROOT, 'packages/cli/test/oracles');
/** Long enough for setup + F (3 runs) + one session's gates + local CI on a loaded machine. */
export const ARM_TIMEOUT = 40 * 60_000;

let tools: Promise<string> | undefined;
/** The fiks-tools image the container tests mount (built once per process from HEAD). */
export function toolsImage(): Promise<string> {
  tools ??= process.env.FIKS_TOOLS_IMAGE
    ? Promise.resolve(process.env.FIKS_TOOLS_IMAGE)
    : buildToolsImage({ ref: 'HEAD', applyFragments: true }).then((i) => i.digest);
  return tools;
}

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `pnpm fiks <args>` as a subprocess (tsx main.ts), with the test's env plus `env`. */
export function fiks(args: string[], env: NodeJS.ProcessEnv = {}): CliRun {
  const r = spawnSync(TSX, [MAIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Every regular file under `dir`, recursively. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export const readJsonl = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T)
    : [];
