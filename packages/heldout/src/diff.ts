// Unified-diff reading for the grader: which files a patch touches and which new-side lines it
// adds (SAST counts findings on the diff only, PLAN 3.0 criterion 4 / 5.8).
import { sha256 } from './hash.ts';

export interface ChangedFile {
  /** Path before the change (null for an added file). */
  oldPath: string | null;
  /** Path after the change (null for a deleted file). */
  newPath: string | null;
  /** 1-based line numbers on the new side that the patch adds. */
  added: number[];
}

const unquote = (p: string) => {
  const t = p.trim();
  if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as string;
  return t.split('\t')[0] as string;
};

const stripPrefix = (p: string): string | null => {
  const s = unquote(p);
  if (s === '/dev/null') return null;
  return s.replace(/^[ab]\//, '');
};

/** Files and added new-side lines of a unified (git) diff. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let cur: ChangedFile | undefined;
  let newLine = 0;
  let inHunk = false;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { oldPath: null, newPath: null, added: [] };
      files.push(cur);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m) {
        cur.oldPath = m[1] as string;
        cur.newPath = m[2] as string;
      }
      inHunk = false;
      continue;
    }
    if (inHunk && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('+')) {
        cur?.added.push(newLine);
        newLine++;
        newLeft--;
      } else if (line.startsWith('-')) {
        oldLeft--;
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file"
      } else {
        newLine++;
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    inHunk = false;
    if (line.startsWith('--- ')) {
      if (!cur || files.at(-1) !== cur) {
        cur = { oldPath: null, newPath: null, added: [] };
        files.push(cur);
      }
      cur.oldPath = stripPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (cur) cur.newPath = stripPrefix(line.slice(4));
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) {
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
      newLine = Number(h[3]);
      inHunk = true;
    }
  }
  return files.filter((f) => f.oldPath !== null || f.newPath !== null);
}

/**
 * A diff normalised for deduplication (PLAN 5.6 "Dedupe by normalised diff"): `index` lines and
 * hunk headers dropped, trailing whitespace trimmed, files sorted by path. Two patches that make
 * the same line changes to the same files normalise to the same text.
 */
export function normalizedDiff(diff: string): string {
  const blocks: { path: string; lines: string[] }[] = [];
  let cur: { path: string; lines: string[] } | undefined;
  for (const raw of diff.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('diff --git ')) {
      cur = { path: line, lines: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur || line.startsWith('index ') || line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith('-')) cur.lines.push(line);
  }
  return blocks
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((b) => [b.path, ...b.lines].join('\n'))
    .join('\n');
}

export const diffSha = (diff: string) => sha256(normalizedDiff(diff));
