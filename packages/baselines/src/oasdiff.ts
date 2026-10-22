// Pinned oasdiff wrapper for B-TRIG's spec-diff trigger [oasdiff-breaking]. The binary is installed
// by `node packages/baselines/scripts/ensure-oasdiff.mjs` (PLAN 8.0-4: approved install) into
// $HOME/.fiks/tools/oasdiff-<version>/, checked against the release's sha256. Any other version
// is refused, so a finding count always comes from the pinned release.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const OASDIFF_VERSION = '1.33.0';

/** The pinned binary: $FIKS_OASDIFF, else $HOME/.fiks/tools/oasdiff-<version>/oasdiff. */
export function oasdiffPath(): string {
  return process.env.FIKS_OASDIFF ?? join(homedir(), '.fiks/tools', `oasdiff-${OASDIFF_VERSION}`, 'oasdiff');
}

function run(bin: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** The installed version, after checking it is the pinned one. */
export function oasdiffVersion(bin = oasdiffPath()): string {
  if (!existsSync(bin))
    throw new Error(
      `oasdiff ${OASDIFF_VERSION} not installed at ${bin}; run node packages/baselines/scripts/ensure-oasdiff.mjs`,
    );
  const out = run(bin, ['--version']).stdout.trim();
  const m = /(\d+\.\d+\.\d+)/.exec(out);
  if (!m || m[1] !== OASDIFF_VERSION)
    throw new Error(`oasdiff at ${bin} reports "${out}", expected ${OASDIFF_VERSION}`);
  return m[1];
}

export interface SpecDiffResult {
  version: string;
  /** `oasdiff breaking` entries (error + warning levels). */
  breaking: number;
  /** `oasdiff changelog` entries (every detected change, breaking or not). */
  changelog: number;
  /** = changelog: B-TRIG fires on any finding, breaking or not. */
  findings: number;
}

function countJson(stdout: string): number {
  const text = stdout.trim();
  if (text === '' || text === 'null') return 0;
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed.length;
  throw new Error(`unexpected oasdiff JSON output: ${text.slice(0, 200)}`);
}

/** Diffs two OpenAPI files (paths) with the pinned oasdiff. */
export function oasdiffFiles(base: string, revision: string, bin = oasdiffPath()): SpecDiffResult {
  const version = oasdiffVersion(bin);
  const breaking = run(bin, ['breaking', base, revision, '--format', 'json']);
  if (breaking.code !== 0) throw new Error(`oasdiff breaking exited ${breaking.code}: ${breaking.stderr}`);
  const changelog = run(bin, ['changelog', base, revision, '--format', 'json']);
  if (changelog.code !== 0)
    throw new Error(`oasdiff changelog exited ${changelog.code}: ${changelog.stderr}`);
  const nBreaking = countJson(breaking.stdout);
  const nChangelog = countJson(changelog.stdout);
  return { version, breaking: nBreaking, changelog: nChangelog, findings: Math.max(nBreaking, nChangelog) };
}

/** Diffs two in-memory OpenAPI documents (written to a temp dir as JSON). */
export function oasdiffDocs(base: unknown, revision: unknown, bin = oasdiffPath()): SpecDiffResult {
  const dir = mkdtempSync(join(tmpdir(), 'fiks-oasdiff-'));
  try {
    const a = join(dir, 'base.json');
    const b = join(dir, 'revision.json');
    writeFileSync(a, JSON.stringify(base));
    writeFileSync(b, JSON.stringify(revision));
    return oasdiffFiles(a, b, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
