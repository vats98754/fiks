// fiks-tools inside per-attempt and grading containers (PLAN P1, round 6): the tools image's
// /opt/fiks is copied once into a volume named after its digest, then mounted read-only at /opt/fiks,
// one sub-mount per top-level entry. /opt/fiks itself stays a directory of the container's read-only
// root, so a worktree can still be mounted below it where the CLI expects one
// (/opt/fiks/.work/wt/ref-<ref>, `shopAt()` in packages/cli/src/paths.ts) while nothing in the tools
// tree is writable and no .env/.fiks/.work exists in it.
//
// execFiks(container, argv) = docker exec <container> with env exactly FIKS_SANDBOX_ENV:
//   /opt/fiks/node_modules/.bin/tsx /opt/fiks/packages/cli/src/main.ts <argv>
import type { ExecOptions, ExecResult } from '@fiks/interfaces';
import { type DockerExecBackend, type Mount, SANDBOX_PATH } from './backend.ts';
import { docker, dockerOk, imageDigest, imageLabels } from './docker.ts';
import { withLock } from './lock.ts';

export const TOOLS_DIR = '/opt/fiks';
export const FIKS_TSX = `${TOOLS_DIR}/node_modules/.bin/tsx`;
export const FIKS_MAIN = `${TOOLS_DIR}/packages/cli/src/main.ts`;
/** P1 round 6: the only variables a sandboxed fiks CLI sees. */
export const FIKS_SANDBOX_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: SANDBOX_PATH,
  CI: '1',
  HOME: '/tmp',
  FIKS_DIR: '/tmp/fiks',
  FIKS_IN_SANDBOX: '1',
});

export interface ToolsOptions {
  /** 'run' (default) refuses a test-only image (built with --apply-fragments). */
  purpose?: 'run' | 'test';
}

const volumeFor = (digest: string) => `fiks-tools-${digest.replace(/^sha256:/, '').slice(0, 24)}`;
const entriesCache = new Map<string, string[]>();

/** Ensures the digest's volume holds a complete copy of /opt/fiks; returns its top-level entries. */
export async function ensureToolsVolume(
  image: string,
  opts: ToolsOptions = {},
): Promise<{
  digest: string;
  volume: string;
  entries: string[];
}> {
  const digest = await imageDigest(image);
  const labels = await imageLabels(digest);
  if (labels['fiks.sandbox.kind'] !== 'tools') throw new Error(`${image} is not a fiks-tools image`);
  if (labels['fiks.tools.testOnly'] === 'true' && (opts.purpose ?? 'run') === 'run') {
    throw new Error(
      `${image} is a test-only fiks-tools image (--apply-fragments); runs use the frozen commit's image`,
    );
  }
  const volume = volumeFor(digest);
  const cached = entriesCache.get(volume);
  if (cached) return { digest, volume, entries: cached };
  const entries = await withLock('docker', async () => {
    const exists = (await docker(['volume', 'inspect', volume])).code === 0;
    if (!exists) {
      await dockerOk([
        'volume',
        'create',
        '--label',
        'fiks.sandbox=1',
        '--label',
        `fiks.tools.digest=${digest}`,
        volume,
      ]);
    }
    // Copy once; `.complete` (outside the mounted sub-paths) marks a finished copy.
    const out = await dockerOk(
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--mount',
        `type=volume,src=${volume},dst=/v`,
        '--entrypoint',
        'sh',
        digest,
        '-c',
        `set -e
if [ ! -e /v/.complete ]; then
  rm -rf /v/fiks /v/entries
  mkdir /v/fiks
  cp -a ${TOOLS_DIR}/. /v/fiks/
  ls -A /v/fiks > /v/entries
  touch /v/.complete
fi
cat /v/entries`,
      ],
      { timeoutMs: 20 * 60_000 },
    );
    return out.split('\n').filter((e) => e && e !== '.' && e !== '..');
  });
  entriesCache.set(volume, entries);
  return { digest, volume, entries };
}

/** Read-only mounts that make the tools image's tree appear at /opt/fiks. */
export async function toolsMounts(image: string, opts: ToolsOptions = {}): Promise<Mount[]> {
  const { volume, entries } = await ensureToolsVolume(image, opts);
  return entries.map((e) => ({
    type: 'volume' as const,
    source: volume,
    target: `${TOOLS_DIR}/${e}`,
    subpath: `fiks/${e}`,
    readonly: true,
  }));
}

/**
 * Runs the fiks CLI inside `container` (a DockerExecBackend created with toolsMounts()), with
 * --network none and env exactly FIKS_SANDBOX_ENV. `cwd` defaults to /tmp.
 */
export function execFiks(
  container: DockerExecBackend,
  argv: string[],
  opts: Pick<ExecOptions, 'input' | 'timeoutMs'> & { cwd?: string } = {},
): Promise<ExecResult> {
  if (!container.mounts.some((m) => m.target.startsWith(`${TOOLS_DIR}/`) && m.readonly)) {
    throw new Error(`container ${container.name} has no read-only fiks-tools mount at ${TOOLS_DIR}`);
  }
  return container.exec(FIKS_TSX, [FIKS_MAIN, ...argv], {
    input: opts.input,
    timeoutMs: opts.timeoutMs,
    env: { ...FIKS_SANDBOX_ENV },
    containerCwd: opts.cwd ?? '/tmp',
  });
}
