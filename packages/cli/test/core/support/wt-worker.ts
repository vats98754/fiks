// Worker for worktree-lock.test.ts: N create/remove cycles of a worktree at seed-v1, under this
// process's own FIKS_DIR.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createWorktree } from '../../../../repro/src/index.ts';

const [repo, cycles, id] = process.argv.slice(2) as [string, string, string];
const fiksDir = process.env.FIKS_DIR as string;
const want = execFileSync('git', ['rev-parse', 'seed-v1^{commit}'], { cwd: repo, encoding: 'utf8' }).trim();
for (let i = 0; i < Number(cycles); i++) {
  const wt = createWorktree(repo, 'seed-v1', {
    dir: join(fiksDir, 'wt', `w${id}-${i}`),
    linkNodeModules: false,
  });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt.dir, encoding: 'utf8' }).trim();
  if (head !== want) throw new Error(`worker ${id} cycle ${i}: HEAD ${head} != ${want}`);
  wt.remove();
  if (existsSync(wt.dir)) throw new Error(`worker ${id} cycle ${i}: ${wt.dir} still exists`);
}
console.log(`worker ${id}: ${cycles} cycles ok`);
