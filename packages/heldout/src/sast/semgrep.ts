// Semgrep CE (first SAST tool), in its own container: image pinned by digest (PLAN 8.0-4),
// --network none, local rules only (semgrep.yml next to this file), metrics off. The files are
// copied into a scratch directory that is mounted read-only; nothing else of the host is visible.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { docker } from '@fiks/sandbox';
import type { SastCategory, SastFinding, SastTool } from './types.ts';

/** semgrep/semgrep:1.179.0 (published 2026-10-02), multi-arch index digest. */
export const SEMGREP_IMAGE =
  'semgrep/semgrep:1.179.0@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b';

export const SEMGREP_RULES = new URL('./semgrep.yml', import.meta.url).pathname;

interface SemgrepJson {
  results?: {
    check_id: string;
    path: string;
    start: { line: number };
    extra?: { metadata?: { category?: string } };
  }[];
  errors?: { message?: string; level?: string }[];
}

/** Parses `semgrep scan --json` output; `root` is the in-container prefix of the scanned files. */
export function parseSemgrep(stdout: string, root: string): SastFinding[] {
  const j = JSON.parse(stdout) as SemgrepJson;
  return (j.results ?? []).map((r) => ({
    tool: 'semgrep' as const,
    rule: r.check_id.split('.').at(-1) ?? r.check_id,
    category: (r.extra?.metadata?.category ?? 'other') as SastCategory,
    file: r.path.startsWith(`${root}/`) ? r.path.slice(root.length + 1) : r.path,
    line: r.start.line,
  }));
}

export interface SemgrepOptions {
  image?: string;
  rules?: string;
  timeoutMs?: number;
}

export function semgrepTool(opts: SemgrepOptions = {}): SastTool {
  return {
    name: 'semgrep',
    async scan(files) {
      if (files.length === 0) return [];
      const dir = mkdtempSync(join(tmpdir(), 'fiks-semgrep-'));
      try {
        for (const f of files) {
          const p = join(dir, 'src', f.path);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, f.source);
        }
        writeFileSync(join(dir, 'rules.yml'), readFileSync(opts.rules ?? SEMGREP_RULES));
        const r = await docker(
          [
            'run',
            '--rm',
            '--network',
            'none',
            '--read-only',
            '--tmpfs',
            '/tmp:rw,size=256m',
            '-e',
            'HOME=/tmp',
            '-e',
            'SEMGREP_SEND_METRICS=off',
            '--mount',
            `type=bind,src=${dir},dst=/scan,readonly`,
            '--workdir',
            '/scan/src',
            opts.image ?? SEMGREP_IMAGE,
            'semgrep',
            'scan',
            '--config',
            '/scan/rules.yml',
            '--json',
            '--metrics=off',
            '--disable-version-check',
            '--no-git-ignore',
            '--quiet',
            '/scan/src',
          ],
          { timeoutMs: opts.timeoutMs ?? 5 * 60_000 },
        );
        // Exit 0 = no findings or findings (no --error); anything else is a tool failure.
        if (r.code !== 0) throw new Error(`semgrep exited ${r.code}: ${r.stderr.slice(-800)}`);
        return parseSemgrep(r.stdout, '/scan/src');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
