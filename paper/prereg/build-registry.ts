// Registry builder (PLAN.md 5.2, F5 `prereg-v1`).
//
//   pnpm tsx paper/prereg/build-registry.ts --dry-run [--repo <dir>] [--manifest <file>]
//   pnpm tsx paper/prereg/build-registry.ts [--final] [--out <file>]
//
// For every path matched by registry-manifest.json it computes the git blob id of the working-tree
// bytes and compares it with `git ls-tree -r HEAD`. --dry-run prints the comparison and writes
// nothing; exit 0 iff every listed path's hash equals its HEAD blob id. Without --dry-run it writes
// paper/prereg/REGISTRY.json, and refuses (exit 1) on any mismatch; --final also refuses while a
// required group matches no file (the state required at the prereg-v1 tag).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/git.ts';
import { buildRegistry, loadManifest, registryJson } from './lib/registry.ts';

const USAGE =
  'usage: build-registry.ts [--dry-run] [--final] [--repo <dir>] [--manifest <file>] [--out <file>]';

function main(argv: string[]): number {
  const here = fileURLToPath(new URL('.', import.meta.url));
  let repo = repoRoot(here);
  let manifestPath = resolve(here, 'registry-manifest.json');
  let out: string | null = null;
  let dryRun = false;
  let final = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--final') final = true;
    else if (a === '--repo' && argv[i + 1] !== undefined) repo = resolve(argv[++i] as string);
    else if (a === '--manifest' && argv[i + 1] !== undefined) manifestPath = resolve(argv[++i] as string);
    else if (a === '--out' && argv[i + 1] !== undefined) out = resolve(argv[++i] as string);
    else {
      console.error(USAGE);
      return 2;
    }
  }
  const manifest = loadManifest(manifestPath);
  const build = buildRegistry(repo, manifest);
  const bad = build.rows.filter((r) => r.status !== 'match');
  console.log(`HEAD ${build.head}`);
  for (const g of manifest.groups) {
    const n = build.groupCounts[g.id] ?? 0;
    console.log(
      `  ${g.id.padEnd(12)} ${String(n).padStart(4)} files${n === 0 ? (g.required ? '  (pending; required at F5)' : '  (pending)') : ''}`,
    );
  }
  for (const r of bad) {
    console.log(
      `MISMATCH ${r.status.padEnd(10)} ${r.path}  computed ${r.gitBlob || '-'}  HEAD ${r.headBlob ?? '-'}`,
    );
  }
  const matched = build.rows.length - bad.length;
  console.log(
    `${matched}/${build.rows.length} listed paths: computed blob id == git ls-tree -r HEAD blob id`,
  );
  const missingRequired = manifest.groups.filter((g) => g.required && build.pending.includes(g.id));
  if (bad.length > 0) {
    console.log('build-registry FAIL: commit or revert the paths above first');
    return 1;
  }
  if (dryRun) {
    console.log('build-registry --dry-run PASS (nothing written)');
    return 0;
  }
  if (final && missingRequired.length > 0) {
    console.log(
      `build-registry FAIL (--final): required groups match no file: ${missingRequired.map((g) => g.id)}`,
    );
    return 1;
  }
  const target = out ?? resolve(here, 'REGISTRY.json');
  writeFileSync(target, registryJson(build, manifest));
  console.log(`wrote ${target} (${build.rows.length} entries)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
