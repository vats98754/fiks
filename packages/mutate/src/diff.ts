// Unified-diff parsing, normalization and in-memory application, for the patch-operator wrapper.
// Built for diffs written by a model: hunk header counts are recomputed from the hunk bodies, a
// bare blank line inside a hunk is an empty context line, and with base sources every hunk is
// relocated to where its old lines actually are.

export interface Hunk {
  /** Stated in the header (1-based); only a hint for the search. */
  oldStart: number;
  /** Text after the closing `@@`, e.g. ` export async function handler(...)`. */
  section: string;
  /** Body lines with their prefix: ' ', '-', '+' or '\' (no newline at end of file). */
  lines: string[];
}

export interface FileDiff {
  path: string;
  hunks: Hunk[];
}

export class DiffError extends Error {}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const stripPrefix = (p: string) => {
  const s = p.replace(/\t.*$/, '').trim();
  return s.startsWith('a/') || s.startsWith('b/') ? s.slice(2) : s;
};

/** The first ```diff (or ```patch) fenced block of a reply, else the whole reply. */
export function extractDiff(reply: string): string {
  const fence = /```(?:diff|patch)[^\n]*\n([\s\S]*?)```/.exec(reply);
  return (fence ? (fence[1] as string) : reply).replace(/\r\n?/g, '\n');
}

/** Parses a unified diff into files and hunks. Throws DiffError on anything it will not apply. */
export function parseDiff(text: string): FileDiff[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  const closeHunk = () => {
    if (hunk) {
      while (hunk.lines.length && hunk.lines[hunk.lines.length - 1] === '') hunk.lines.pop();
      // A trailing bare blank line was the end of the text, not context.
      hunk.lines = hunk.lines.map((l) => (l === '' ? ' ' : l));
      if (!hunk.lines.some((l) => l[0] === '+' || l[0] === '-')) {
        throw new DiffError(`hunk at line ${hunk.oldStart} of ${file?.path} changes nothing`);
      }
    }
    hunk = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (
      /^(?:rename|copy) (?:from|to) |^(?:new|deleted) file mode|^Binary files |^GIT binary patch/.test(line)
    ) {
      throw new DiffError(`unsupported diff line: ${line}`);
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      closeHunk();
      const from = stripPrefix(line.slice(4));
      const to = stripPrefix((lines[i + 1] as string).slice(4));
      if (from === '/dev/null' || to === '/dev/null')
        throw new DiffError('new or deleted files are not allowed');
      if (from !== to) throw new DiffError(`renames are not allowed: ${from} -> ${to}`);
      file = files.find((f) => f.path === to) ?? null;
      if (!file) {
        file = { path: to, hunks: [] };
        files.push(file);
      }
      i++;
      continue;
    }
    const h = HUNK.exec(line);
    if (h) {
      if (!file) throw new DiffError('hunk before any ---/+++ header');
      closeHunk();
      hunk = { oldStart: Number(h[1]), section: h[5] ?? '', lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      const c = line[0];
      if (line === '' || c === ' ' || c === '+' || c === '-' || c === '\\') {
        hunk.lines.push(line);
        continue;
      }
      closeHunk();
    }
    // Anything else between files (diff --git, index, mode lines, prose) is ignored.
  }
  closeHunk();
  if (files.length === 0 || files.every((f) => f.hunks.length === 0)) throw new DiffError('no hunks found');
  for (const f of files) if (f.hunks.length === 0) throw new DiffError(`no hunks for ${f.path}`);
  return files;
}

const oldSide = (h: Hunk) => h.lines.filter((l) => l[0] === ' ' || l[0] === '-').map((l) => l.slice(1));
const newSide = (h: Hunk) => h.lines.filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1));

interface Placed {
  hunk: Hunk;
  /** 0-based index of the first old line in the base. */
  at: number;
}

function splitLines(content: string): { lines: string[]; eofNewline: boolean } {
  const eofNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (eofNewline) lines.pop();
  return { lines, eofNewline };
}

/** Index nearest to `hint` where `needle` occurs in `hay` at or after `from`, or -1. */
function locate(
  hay: string[],
  needle: string[],
  from: number,
  hint: number,
  eq: (a: string, b: string) => boolean,
): number {
  let best = -1;
  for (let p = from; p + needle.length <= hay.length; p++) {
    let ok = true;
    for (let k = 0; k < needle.length && ok; k++) ok = eq(hay[p + k] as string, needle[k] as string);
    if (ok && (best < 0 || Math.abs(p - hint) < Math.abs(best - hint))) best = p;
  }
  return best;
}

/** Places each hunk of `fd` in `base` (exact match, then ignoring trailing whitespace). */
function place(fd: FileDiff, base: string[]): Placed[] {
  const placed: Placed[] = [];
  let cursor = 0;
  const hunks = [...fd.hunks].sort((a, b) => a.oldStart - b.oldStart);
  for (const hunk of hunks) {
    const old = oldSide(hunk);
    const hint = Math.max(0, hunk.oldStart - 1);
    if (old.length === 0) {
      placed.push({ hunk, at: Math.min(Math.max(hint + 1, cursor), base.length) });
      continue;
    }
    let at = locate(base, old, cursor, hint, (a, b) => a === b);
    if (at < 0) {
      at = locate(base, old, cursor, hint, (a, b) => a.trimEnd() === b.trimEnd());
      if (at >= 0) {
        // Rewrite the old side to the base's exact bytes so the emitted patch applies.
        let k = 0;
        hunk.lines = hunk.lines.map((l) => {
          if (l[0] !== ' ' && l[0] !== '-') return l;
          return l[0] + (base[at + k++] as string);
        });
      }
    }
    if (at < 0) {
      throw new DiffError(`${fd.path}: hunk @@ -${hunk.oldStart} does not match the base source`);
    }
    placed.push({ hunk, at });
    cursor = at + old.length;
  }
  return placed;
}

/** Applies placed hunks to base lines; returns the new content. */
function applyPlaced(base: { lines: string[]; eofNewline: boolean }, placed: Placed[]): string {
  const out: string[] = [];
  let i = 0;
  let eofNewline = base.eofNewline;
  for (const { hunk, at } of placed) {
    while (i < at) out.push(base.lines[i++] as string);
    out.push(...newSide(hunk));
    i += oldSide(hunk).length;
    for (let k = 1; k < hunk.lines.length; k++) {
      if ((hunk.lines[k] as string)[0] !== '\\') continue;
      const prev = (hunk.lines[k - 1] as string)[0];
      if (prev === '+' || prev === ' ') eofNewline = false;
      else if (prev === '-' && !hunk.lines.slice(k + 1).some((l) => l[0] === '\\')) eofNewline = true;
    }
  }
  while (i < base.lines.length) out.push(base.lines[i++] as string);
  return out.join('\n') + (eofNewline && out.length ? '\n' : '');
}

function header(oldStart: number, oldCount: number, newStart: number, newCount: number, section: string) {
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${section}`;
}

/** Writes files and placed hunks as a git-style unified diff with correct starts and counts. */
function emit(files: { path: string; placed: Placed[] }[]): string {
  let s = '';
  for (const { path, placed } of files) {
    s += `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
    let delta = 0;
    for (const { hunk, at } of placed) {
      const oc = oldSide(hunk).length;
      const nc = newSide(hunk).length;
      const os = oc === 0 ? at : at + 1;
      const ns = nc === 0 ? at + delta : at + 1 + delta;
      s += `${header(os, oc, ns, nc, hunk.section)}\n${hunk.lines.join('\n')}\n`;
      delta += nc - oc;
    }
  }
  return s;
}

export interface NormalizedDiff {
  diff: string;
  files: string[];
  /** True when every hunk was located in, and applied to, the given base sources. */
  verified: boolean;
  /** New content per file (only when verified). */
  result?: Record<string, string>;
}

/**
 * Normalizes a parsed diff. With `base` (path -> BASE content) each hunk is located and applied in
 * memory, and the emitted diff applies to exactly those sources. Without it, only the header
 * counts are recomputed and starts keep the stated values.
 */
export function normalizeDiff(files: FileDiff[], base?: Record<string, string>): NormalizedDiff {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!base) {
    const out = sorted.map((f) => ({
      path: f.path,
      placed: [...f.hunks]
        .sort((a, b) => a.oldStart - b.oldStart)
        .map((hunk) => ({ hunk, at: oldSide(hunk).length === 0 ? hunk.oldStart : hunk.oldStart - 1 })),
    }));
    return { diff: emit(out), files: sorted.map((f) => f.path), verified: false };
  }
  const result: Record<string, string> = {};
  const out: { path: string; placed: Placed[] }[] = [];
  for (const f of sorted) {
    const content = base[f.path];
    if (content === undefined) throw new DiffError(`${f.path} is not among the base sources`);
    const b = splitLines(content);
    const placed = place(f, b.lines);
    result[f.path] = applyPlaced(b, placed);
    if (result[f.path] === content) throw new DiffError(`${f.path}: the patch changes nothing`);
    out.push({ path: f.path, placed });
  }
  return { diff: emit(out), files: sorted.map((f) => f.path), verified: true, result };
}

/** Paths touched by a diff, sorted. */
export const diffFiles = (diff: string): string[] =>
  parseDiff(diff)
    .map((f) => f.path)
    .sort();
