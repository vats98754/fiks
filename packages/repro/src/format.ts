import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Formats files fiks writes into shop-mcp with shop-mcp's own Biome, so its CI lint passes. */
export function formatFiles(repoDir: string, files: string[]): void {
  if (files.length === 0) return;
  execFileSync(
    join(repoDir, 'node_modules/.bin/biome'),
    ['format', '--write', '--vcs-enabled=false', ...files],
    {
      cwd: repoDir,
      stdio: 'pipe',
    },
  );
}

/** fiks's own checkout: its Biome binary and config are outside anything agent code may change. */
const FIKS_ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Formats text in memory and returns the bytes fiks will own. It runs fiks's own Biome with
 * fiks's config (same formatter settings as shop-mcp), never the tool's node_modules, and reads
 * nothing back from disk, so no other process can change what fiks commits.
 */
export function formatInMemory(fileName: string, text: string): string {
  return execFileSync(
    join(FIKS_ROOT, 'node_modules/.bin/biome'),
    ['format', '--vcs-enabled=false', `--stdin-file-path=${fileName}`],
    { cwd: FIKS_ROOT, input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}
