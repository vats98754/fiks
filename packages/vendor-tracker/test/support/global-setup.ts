import { execFileSync } from 'node:child_process';

export default function setup() {
  const root = new URL('../../../../', import.meta.url).pathname;
  execFileSync('node', ['scripts/ensure-tracker-mcp.mjs'], { cwd: root, stdio: 'inherit' });
}
