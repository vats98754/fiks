import { join } from 'node:path';

export const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
/** Clones and worktrees. Tests point FIKS_WORK_DIR at a temp folder. */
export const WORK_DIR = process.env.FIKS_WORK_DIR ?? join(ROOT, '.work');
/** Scratch output: traces and the event log. Tests point FIKS_DIR at a temp folder. */
export const FIKS_DIR = process.env.FIKS_DIR ?? join(ROOT, '.fiks');

/** The shop-mcp checkout the harness runs (override with FIKS_SHOP_DIR). */
export function shopDir(): string {
  return process.env.FIKS_SHOP_DIR ?? join(ROOT, '.work', 'shop-mcp');
}
