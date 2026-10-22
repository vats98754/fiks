// Where each export's files come from: the domain's public docs (OpenAPI + prose, frozen at F2), the
// vendor v1 source, and the MCP server's files at a git ref (read with `git show`, no checkout).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileSource, type SourceFile } from './export.ts';

export const FIKS_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');

export type DomainId = 'shop' | 'tracker';
export const DOMAINS: readonly DomainId[] = ['shop', 'tracker'];

export function asDomainId(d: string): DomainId {
  if (d !== 'shop' && d !== 'tracker')
    throw new Error(`unknown domain ${JSON.stringify(d)} (shop | tracker)`);
  return d;
}

/** The public docs of a domain (repo-relative source path -> export path under `docs/`). */
export const DOCS: Record<DomainId, { src: string; to: string }[]> = {
  shop: [
    { src: 'packages/vendor-api/openapi.json', to: 'openapi.json' },
    { src: 'packages/vendor-api/docs/shop.md', to: 'shop.md' },
  ],
  tracker: [
    { src: 'packages/vendor-tracker/docs/openapi.json', to: 'openapi.json' },
    { src: 'packages/vendor-tracker/docs/tracker.md', to: 'tracker.md' },
  ],
};

/**
 * Vendor v1 source files offered to drift, fixer and benign authors. The deny list still applies
 * (a file importing a fiks package is left out). Seeded-drift code (`drifts.ts`, `devdrift.ts`) and
 * harness glue (truth, entity classes, enumeration, recording) are never offered.
 */
export const VENDOR_SOURCES: Record<DomainId, string[]> = {
  shop: [
    'packages/vendor-api/src/server.ts',
    'packages/vendor-api/src/catalog.ts',
    'packages/vendor-api/src/openapi.ts',
    'packages/vendor-api/src/main.ts',
  ],
  tracker: [
    'packages/vendor-tracker/src/server.ts',
    'packages/vendor-tracker/src/catalog.ts',
    'packages/vendor-tracker/src/model.ts',
    'packages/vendor-tracker/src/main.ts',
  ],
};

export function docsSources(domain: DomainId, prefix = 'docs', root = FIKS_ROOT): SourceFile[] {
  return DOCS[domain].map((d) => fileSource(join(root, d.src), `${prefix}/${d.to}`));
}

export function docsPaths(domain: DomainId, root = FIKS_ROOT): string[] {
  return DOCS[domain].map((d) => join(root, d.src));
}

export function vendorSources(domain: DomainId, prefix: string, root = FIKS_ROOT): SourceFile[] {
  return VENDOR_SOURCES[domain].map((p) => fileSource(join(root, p), `${prefix}/${p.split('/').pop()}`));
}

const git = (repo: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    maxBuffer: 256 * 1024 * 1024,
  });

/** `<ref>^{commit}` in a local repo (no fetch). */
export function resolveCommit(repo: string, ref: string): string {
  return git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    .toString('utf8')
    .trim();
}

/**
 * The server's files at a commit, as the repo lays them out: `src/**`, `test/**` and the non-fiks
 * config (package.json, lockfile, tsconfig, biome, .npmrc, .nvmrc, CI, vendor/openapi.json).
 */
export const SERVER_PATHSPECS = [
  'src',
  'test',
  'vendor',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'biome.json',
  'vitest.config.ts',
  '.npmrc',
  '.nvmrc',
  '.gitignore',
  '.github/workflows/ci.yml',
  'README.md',
];

export function serverSources(repo: string, ref: string, prefix = ''): SourceFile[] {
  const commit = resolveCommit(repo, ref);
  const names = git(repo, ['ls-tree', '-r', '-z', '--name-only', commit, '--', ...SERVER_PATHSPECS])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return names.map((n) => ({
    path: prefix ? `${prefix}/${n}` : n,
    bytes: git(repo, ['cat-file', 'blob', `${commit}:${n}`]),
    origin: `${repo}@${commit}:${n}`,
  }));
}
