// Minimal unified-diff parsing. Used to turn a `.patch` file (a hand-planted malicious patch or a
// D1-D5 oracle fix) into an AttemptOutcome, and to pull the added source lines an AST detector reads.
import type { ChangedFile } from './types.ts';

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const NEW_FILE = /^\+\+\+ b\/(.+)$/;
const DEL_FILE = /^--- a\/(.+)$/;
const RENAME_OR_COPY_FROM = /^(rename|copy) from (.+)$/;
const RENAME_OR_COPY_TO = /^(rename|copy) to (.+)$/;

/**
 * Splits a multi-file unified diff into one ChangedFile per `diff --git` stanza, plus one extra
 * entry per path a stanza touches besides its destination. `git diff` detects renames by default
 * (and copies with -C), so `rename from .github/workflows/ci.yml` / `rename to src/ci.ts` removes a
 * CI file even though the stanza's destination is in src/. The source path of every rename or copy
 * (the `rename from` / `copy from` line, else the `a/` path when it differs from `b/`) is therefore
 * emitted as its own ChangedFile, with `source` set and a header-only diff (no hunks, so added lines
 * are never counted twice). Oracles that ask "which paths did this run touch" see both sides.
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const lines = diff.split('\n');
  const files: ChangedFile[] = [];
  let current: {
    path: string;
    aPath: string;
    from?: { kind: 'rename' | 'copy'; path: string };
    lines: string[];
    headerEnd: number | null;
    inHunks: boolean;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const c = current;
    files.push({ path: c.path, diff: c.lines.join('\n') });
    const kind = c.from?.kind ?? 'rename';
    const srcPath = c.from?.path ?? c.aPath;
    if (srcPath && srcPath !== c.path) {
      const header = c.lines.slice(0, c.headerEnd ?? c.lines.length).join('\n');
      files.push({ path: srcPath, diff: header, source: { kind, of: c.path } });
    }
    current = null;
  };

  for (const line of lines) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      flush();
      // Prefer the `b/` path; `/dev/null` on a deletion is handled by the +++/--- lines below.
      current = {
        path: header[2] ?? header[1] ?? '',
        aPath: header[1] ?? '',
        lines: [line],
        headerEnd: null,
        inHunks: false,
      };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (current.headerEnd === null) {
      // Extended header lines end at the first `--- `, `@@` or `Binary files` line.
      if (line.startsWith('--- ') || line.startsWith('@@') || line.startsWith('Binary files ')) {
        current.headerEnd = current.lines.length - 1;
      } else {
        const from = RENAME_OR_COPY_FROM.exec(line);
        if (from?.[1] && from[2]) current.from = { kind: from[1] as 'rename' | 'copy', path: from[2] };
        const to = RENAME_OR_COPY_TO.exec(line);
        if (to?.[2]) current.path = to[2];
      }
    }
    // `--- a/` and `+++ b/` are path headers only before the file's first `@@`. Inside a hunk, an
    // added line `++ b/README.md` reads `+++ b/README.md` (and a removed `-- a/x` reads `--- a/x`);
    // treating those as headers would let an added line rename the file the oracles see.
    if (line.startsWith('@@')) current.inHunks = true;
    if (current.inHunks) continue;
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
    .filter((s) => s !== '')
    .join('\n');
}
