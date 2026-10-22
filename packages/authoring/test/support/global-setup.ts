import { execFileSync } from 'node:child_process';

export default function setup() {
  const root = new URL('../../../../', import.meta.url).pathname;
  for (const s of ['scripts/ensure-shop-mcp.mjs', 'scripts/ensure-tracker-mcp.mjs'])
    execFileSync('node', [s], { cwd: root, stdio: 'inherit' });
}
