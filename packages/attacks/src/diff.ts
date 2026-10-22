// Minimal unified-diff parsing. Used to turn a `.patch` file (a hand-planted malicious patch or a
// D1-D5 oracle fix) into an AttemptOutcome, and to pull the added source lines an AST detector reads.
import type { ChangedFile } from './types.ts';

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const NEW_FILE = /^\+\+\+ b\/(.+)$/;
const DEL_FILE = /^--- a\/(.+)$/;

/** Splits a multi-file unified diff into one ChangedFile per `diff --git` stanza. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const lines = diff.split('\n');
  const files: ChangedFile[] = [];
  let current: { path: string; lines: string[] } | null = null;

  const flush = () => {
    if (current) files.push({ path: current.path, diff: current.lines.join('\n') });
    current = null;
  };

  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      // Prefer the `b/` path; `/dev/null` on a deletion is handled by the +++/--- lines below.
      current = { path: header[2] ?? header[1] ?? '', lines: [line] };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    const newFile = NEW_FILE.exec(line);
    if (newFile?.[1] && newFile[1] !== '/dev/null') current.path = newFile[1];
    const delFile = DEL_FILE.exec(line);
    // A pure deletion: `+++ /dev/null`; keep the a/ path so the oracle still sees the touched file.
    if (delFile?.[1] && current.path === '/dev/null') current.path = delFile[1];
  }
  flush();
  return files;
}

/**
 * The added lines of a single file's diff, joined. Only the real `+++ ` file header (the line right
 * after a `--- ` header, before the first hunk) is skipped: an added source line that itself starts
 * with `++` (e.g. `++counter;`) appears as `+++counter;` inside a hunk and is kept.
 */
export function addedLines(fileDiff: string): string {
  const out: string[] = [];
  let inHunk = false;
  let prevWasOldHeader = false;
  for (const l of fileDiff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      inHunk = false;
      prevWasOldHeader = false;
      continue;
    }
    if (!inHunk && l.startsWith('--- ')) {
      prevWasOldHeader = true;
      continue;
    }
    if (prevWasOldHeader && l.startsWith('+++ ')) {
      prevWasOldHeader = false;
      continue;
    }
    prevWasOldHeader = false;
    if (l.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (l.startsWith('+')) out.push(l.slice(1));
  }
  return out.join('\n');
}

/** All added lines across every file in a multi-file diff. */
export function addedLinesAll(diff: string): string {
  return parseUnifiedDiff(diff)
    .map((f) => addedLines(f.diff))
    .join('\n');
}
