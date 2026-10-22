// Manifest-built blind exports (PLAN 5.2 item 2): physical directories outside ~/fiks, written from
// an explicit file list. Every candidate file passes the deny list (deny.ts) or is recorded as
// excluded. The manifest lives next to the export (`<dir>.manifest.json`), never inside it, so the
// export's file list equals the manifest's `files` exactly.
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { denyReason } from './deny.ts';

export const EXPORT_KINDS = [
  'drift',
  'evasive',
  'benign',
  'catalog',
  'contract-author',
  'contract-llm',
  'fixer',
  'rater',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** One candidate file: its export-relative path, bytes and where it came from (manifest only). */
export interface SourceFile {
  path: string;
  bytes: Buffer;
  origin: string;
}

export interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
  origin: string;
}

export interface ExportManifest {
  schema: 'fiks-blind-export/1';
  kind: ExportKind;
  label: string;
  domain: string | null;
  dir: string;
  createdAt: string;
  files: ManifestEntry[];
  excluded: { path: string; origin: string; reason: string }[];
  /** sha256 over the sorted (path, sha256) list: identical content gives an identical hash. */
  contentSha256: string;
}

export interface BuiltExport {
  dir: string;
  manifest: ExportManifest;
  manifestPath: string;
  /** sha256 of the manifest file bytes. */
  manifestSha256: string;
}

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Default parent directory of exports: $FIKS_BLIND_EXPORT_ROOT, else `<tmpdir>/blind-exports`. */
export function defaultExportRoot(): string {
  return process.env.FIKS_BLIND_EXPORT_ROOT ?? join(tmpdir(), 'blind-exports');
}

const real = (p: string) => {
  let cur = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      tail.push(cur.slice(parent.length + 1));
      cur = parent;
    }
  }
};

/** Roots no export may live under: ~/fiks, every fiks worktree (~/fiks-wt) and this checkout. */
export function forbiddenExportRoots(): string[] {
  const repo = new URL('../../../', import.meta.url).pathname;
  return [join(homedir(), 'fiks'), join(homedir(), 'fiks-wt'), repo].map(real);
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertOutsideFiks(dir: string): void {
  const r = real(dir);
  for (const root of forbiddenExportRoots()) {
    if (isInside(r, root))
      throw new Error(`export dir ${r} is inside ${root}; exports must live outside ~/fiks`);
  }
}

const toPosix = (p: string) => p.split(sep).join('/');

function checkRelPath(p: string): string {
  const n = toPosix(p).replace(/^\.\//, '');
  if (!n || isAbsolute(n) || n.split('/').some((s) => s === '..' || s === '')) {
    throw new Error(`bad export path ${JSON.stringify(p)}`);
  }
  return n;
}

/** Writes an export: deny-filtered files under a fresh dir (outside ~/fiks) plus its sibling manifest. */
export function buildExport(opts: {
  kind: ExportKind;
  label: string;
  domain?: string;
  files: SourceFile[];
  /** Parent dir (default `defaultExportRoot()`); the export is `<root>/<kind>-<label>-<rand>`. */
  root?: string;
  /** Exact dir to create (must not exist). */
  dir?: string;
}): BuiltExport {
  const dir = resolve(
    opts.dir ??
      join(
        opts.root ?? defaultExportRoot(),
        `${opts.kind}-${opts.label.replace(/[^\w.-]+/g, '_')}-${randomBytes(4).toString('hex')}`,
      ),
  );
  assertOutsideFiks(dir);
  if (existsSync(dir)) throw new Error(`export dir ${dir} already exists`);
  const seen = new Set<string>();
  const files: ManifestEntry[] = [];
  const excluded: ExportManifest['excluded'] = [];
  for (const f of opts.files) {
    const rel = checkRelPath(f.path);
    if (seen.has(rel)) throw new Error(`duplicate export path ${rel}`);
    seen.add(rel);
    const reason = denyReason(rel, f.bytes);
    if (reason) {
      excluded.push({ path: rel, origin: f.origin, reason });
      continue;
    }
    files.push({ path: rel, sha256: sha256(f.bytes), bytes: f.bytes.length, origin: f.origin });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  excluded.sort((a, b) => (a.path < b.path ? -1 : 1));
  mkdirSync(dir, { recursive: true });
  const byPath = new Map(opts.files.map((f) => [checkRelPath(f.path), f.bytes]));
  for (const e of files) {
    const abs = join(dir, e.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, byPath.get(e.path) as Buffer);
  }
  const realDir = realpathSync(dir);
  const manifest: ExportManifest = {
    schema: 'fiks-blind-export/1',
    kind: opts.kind,
    label: opts.label,
    domain: opts.domain ?? null,
    dir: realDir,
    createdAt: new Date().toISOString(),
    files,
    excluded,
    contentSha256: sha256(files.map((f) => `${f.path}\0${f.sha256}\n`).join('')),
  };
  const manifestPath = `${realDir}.manifest.json`;
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  return { dir: realDir, manifest, manifestPath, manifestSha256: sha256(text) };
}

/** Every regular file under `dir`, as sorted export-relative POSIX paths (symlinks are reported too). */
export function listFiles(dir: string, opts: { skip?: (rel: string) => boolean } = {}): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      const rel = toPosix(relative(dir, abs));
      if (opts.skip?.(rel)) continue;
      if (ent.isDirectory()) walk(abs);
      else out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** Problems with an export against its manifest: extra, missing or changed files (empty = equal). */
export function verifyExport(
  dir: string,
  manifest: ExportManifest,
  opts: { skip?: (rel: string) => boolean } = {},
): string[] {
  const problems: string[] = [];
  const want = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  const have = listFiles(dir, opts);
  for (const p of have) {
    if (!want.has(p)) problems.push(`extra file ${p}`);
    else if (sha256(readFileSync(join(dir, p))) !== want.get(p)) problems.push(`changed file ${p}`);
  }
  const haveSet = new Set(have);
  for (const p of want.keys()) if (!haveSet.has(p)) problems.push(`missing file ${p}`);
  for (const p of have) {
    const reason = denyReason(p, readFileSync(join(dir, p)));
    if (reason) problems.push(`denied file ${p} (${reason})`);
  }
  return problems;
}

export function readManifest(dir: string): ExportManifest {
  return JSON.parse(readFileSync(`${realpathSync(dir)}.manifest.json`, 'utf8')) as ExportManifest;
}

/** Removes an export and its manifest. */
export function removeExport(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}.manifest.json`, { force: true });
}

/** Reads files under `absDir` into SourceFiles under `prefix` (optionally filtered by relative path). */
export function dirSources(absDir: string, prefix: string, filter?: (rel: string) => boolean): SourceFile[] {
  if (!existsSync(absDir) || !statSync(absDir).isDirectory()) throw new Error(`no directory ${absDir}`);
  return listFiles(absDir)
    .filter((rel) => !filter || filter(rel))
    .map((rel) => ({
      path: prefix ? `${prefix}/${rel}` : rel,
      bytes: readFileSync(join(absDir, rel)),
      origin: join(absDir, rel),
    }));
}

export function fileSource(abs: string, path: string): SourceFile {
  return { path, bytes: readFileSync(abs), origin: abs };
}

export function textSource(path: string, text: string, origin = 'generated'): SourceFile {
  return { path, bytes: Buffer.from(text), origin };
}
