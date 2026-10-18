import { join } from 'node:path';

export const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
export const WORK_DIR = join(ROOT, '.work');
export const FIKS_DIR = join(ROOT, '.fiks');

/** The shop-mcp checkout the harness runs (override with FIKS_SHOP_DIR). */
export function shopDir(): string {
  return process.env.FIKS_SHOP_DIR ?? join(WORK_DIR, 'shop-mcp');
}
