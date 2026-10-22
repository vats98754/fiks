// REGISTRY.json builder (PLAN 5.2 F5): git blob ids and sha256 of every registered path.
// Blob ids are computed from the working-tree bytes and compared with `git ls-tree -r HEAD`, so a
// registry can only be written from a tree whose registered paths are exactly what HEAD commits.
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitBlobId, sha256 } from './git.ts';
import { matchesGlob } from './glob.ts';

export interface RegistryGroup {
  id: string;
  why: string;
  required: boolean;
  globs: string[];
}

export interface RegistryManifest {
  description?: string;
  exclude: string[];
  groups: RegistryGroup[];
}

export interface RegistryEntry {
  path: string;
  group: string;
  gitBlob: string;
  sha256: string;
  bytes: number;
}

export type EntryStatus = 'match' | 'modified' | 'untracked' | 'deleted' | 'not-a-blob';

export interface RegistryRow extends RegistryEntry {
  headBlob: string | null;
  status: EntryStatus;
}

export interface RegistryBuild {
  head: string;
  rows: RegistryRow[];
  groupCounts: Record<string, number>;
  pending: string[];
}

export function loadManifest(path: string): RegistryManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as RegistryManifest;
}

/** `git ls-tree -r -z HEAD` as path -> {mode, type, sha}. */
export function lsTreeHead(repo: string): Map<string, { mode: string; type: string; sha: string }> {
  const out = new Map<string, { mode: string; type: string; sha: string }>();
  for (const line of git(repo, ['ls-tree', '-r', '-z', 'HEAD']).split('\0')) {
    if (line === '') continue;
    const tab = line.indexOf('\t');
    const [mode, type, sha] = line.slice(0, tab).split(' ') as [string, string, string];
    out.set(line.slice(tab + 1), { mode, type, sha });
  }
  return out;
}

function untracked(repo: string): string[] {
  return git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((p) => p !== '');
}

function workingBytes(repo: string, path: string): Buffer | null {
  const abs = join(repo, path);
  if (!existsSync(abs) && !isSymlink(abs)) return null;
  if (isSymlink(abs)) return Buffer.from(readlinkSync(abs));
  return readFileSync(abs);
}

function isSymlink(abs: string): boolean {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

export function buildRegistry(repo: string, manifest: RegistryManifest): RegistryBuild {
  const head = git(repo, ['rev-parse', 'HEAD']);
  const tree = lsTreeHead(repo);
  const candidates = new Set<string>([...tree.keys(), ...untracked(repo)]);
  const rows: RegistryRow[] = [];
  const groupCounts: Record<string, number> = Object.fromEntries(manifest.groups.map((g) => [g.id, 0]));
  for (const path of [...candidates].sort()) {
    if (manifest.exclude.some((g) => matchesGlob(path, g))) continue;
    const group = manifest.groups.find((g) => g.globs.some((glob) => matchesGlob(path, glob)));
    if (group === undefined) continue;
    groupCounts[group.id] = (groupCounts[group.id] ?? 0) + 1;
    const inHead = tree.get(path);
    const bytes = workingBytes(repo, path);
    const blob = bytes === null ? '' : gitBlobId(bytes);
    let status: EntryStatus;
    if (inHead !== undefined && inHead.type !== 'blob') status = 'not-a-blob';
    else if (inHead === undefined) status = 'untracked';
    else if (bytes === null) status = 'deleted';
    else status = blob === inHead.sha ? 'match' : 'modified';
    rows.push({
      path,
      group: group.id,
      gitBlob: blob,
      sha256: bytes === null ? '' : sha256(bytes),
      bytes: bytes?.length ?? 0,
      headBlob: inHead?.sha ?? null,
      status,
    });
  }
  const pending = manifest.groups.filter((g) => groupCounts[g.id] === 0).map((g) => g.id);
  return { head, rows, groupCounts, pending };
}

export function registryJson(build: RegistryBuild, manifest: RegistryManifest): string {
  const entries: RegistryEntry[] = build.rows.map(({ path, group, gitBlob, sha256: s, bytes }) => ({
    path,
    group,
    gitBlob,
    sha256: s,
    bytes,
  }));
  const doc = {
    schemaVersion: 1,
    description:
      'Blob ids (git hash-object) and sha256 of every registered path, computed from a working tree equal to HEAD (paper/prereg/build-registry.ts).',
    head: build.head,
    groups: manifest.groups.map((g) => ({
      id: g.id,
      required: g.required,
      globs: g.globs,
      files: build.groupCounts[g.id] ?? 0,
    })),
    pending: build.pending,
    entries,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
