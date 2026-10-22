// Locations of the R20 metadata and of the clone (PLAN 5.10, round 6: the clone lives under the
// gitignored .work/, never inside realbugs/R20/).
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUG_ID = 'R20';
export const BUG_DIR = fileURLToPath(new URL('..', import.meta.url));
export const FIKS_ROOT = resolve(BUG_DIR, '../..');
export const HARNESS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** `.work/realbugs/R20` (FIKS_REALBUG_DIR overrides; relative paths resolve against the fiks root). */
export function repoDir(env = process.env): string {
  const d = env.FIKS_REALBUG_DIR ?? '.work/realbugs/R20';
  return isAbsolute(d) ? d : resolve(FIKS_ROOT, d);
}

/** Per-commit build trees: `<repoDir>.builds/<sha>` (FIKS_REALBUG_BUILDS_DIR overrides). */
export function buildsDir(env = process.env): string {
  const d = env.FIKS_REALBUG_BUILDS_DIR;
  if (!d) return `${repoDir(env)}.builds`;
  return isAbsolute(d) ? d : resolve(FIKS_ROOT, d);
}
