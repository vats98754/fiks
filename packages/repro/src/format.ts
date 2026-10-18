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
