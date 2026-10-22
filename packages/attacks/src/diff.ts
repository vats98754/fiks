// Minimal unified-diff parsing. Used to turn a `.patch` file (a hand-planted malicious patch or a
// D1-D5 oracle fix) into an AttemptOutcome, and to pull the added source lines an AST detector reads.
import type { ChangedFile } from './types.ts';

const RENAME_OR_COPY_FROM = /^(rename|copy) from (.+)$/;
const RENAME_OR_COPY_TO = /^(rename|copy) to (.+)$/;
const DIFF_GIT = 'diff --git ';
/** A `--- `, `+++ ` or `@@ ` line: file content a stanza without a `diff --git` line would carry. */
const BARE_FILE_LINE = /^(--- |\+\+\+ |@@ )/;

/**
 * Path prefix of the entry emitted for a stanza the parser cannot read. It starts with `<`, so it
 * matches no repo path pattern (in particular not an `src/` edit allow-list).
 */
export const UNPARSED_PATH_PREFIX = '<unparsed diff>/';

/** Single-character escapes git's quote_c_style emits (besides `\ooo` octal bytes). */
const C_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
const utf8 = new TextEncoder();

/**
 * Reads one C-quoted git path starting at `s[start] === '"'`. Git quotes a path that holds a byte
 * >= 0x80, a control character, `"` or `\` (core.quotePath=true, the default): non-ASCII bytes and
 * controls become `\ooo` octal escapes, so `é` is `\303\251`. The escaped bytes are reassembled and
 * decoded as UTF-8. Returns the decoded path and the index just past the closing quote, or null when
 * the text is not a well-formed quoted string.
 */
function readQuoted(s: string, start: number): { value: string; end: number } | null {
  if (s[start] !== '"') return null;
  const bytes: number[] = [];
  let i = start + 1;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === '"') return { value: new TextDecoder().decode(Uint8Array.from(bytes)), end: i + 1 };
    if (c === '\\') {
      const oct = /^[0-3][0-7]{2}/.exec(s.slice(i + 1, i + 4));
      if (oct) {
        bytes.push(Number.parseInt(oct[0], 8));
        i += 4;
        continue;
      }
      const esc = C_ESCAPES[s[i + 1] ?? ''];
      if (esc === undefined) return null;
      bytes.push(esc);
      i += 2;
      continue;
    }
    // A literal character (an unquoted-safe byte, or raw UTF-8 under core.quotePath=false).
    const ch = String.fromCodePoint(s.codePointAt(i) as number);
    bytes.push(...utf8.encode(ch));
    i += ch.length;
  }
  return null;
}

/** A path field that is either C-quoted or bare (a bare one ends at the end of the text). */
function unquote(field: string): string | null {
  return field.startsWith('"') ? (readQuoted(field, 0)?.value ?? null) : field;
}

/** Drops a required `a/` or `b/` prefix; null when it is missing. */
const stripPrefix = (path: string, prefix: 'a/' | 'b/'): string | null =>
  path.startsWith(prefix) ? path.slice(prefix.length) : null;

/**
 * The path on a `--- ` / `+++ ` line: null for `/dev/null` or a malformed line. Git appends a TAB to
 * the path when it contains a space (`+++ b/src/my tool.ts\t`, also after a quoted path), so a bare
 * path ends at the first TAB (a real TAB in a path is always quoted).
 */
function headerPath(rest: string, prefix: 'a/' | 'b/'): string | null {
  let path: string | null;
  if (rest.startsWith('"')) path = readQuoted(rest, 0)?.value ?? null;
  else {
    const tab = rest.indexOf('\t');
    path = tab < 0 ? rest : rest.slice(0, tab);
  }
  if (path === null || path === '/dev/null') return null;
  return stripPrefix(path, prefix);
}

/**
 * The `a/` and `b/` paths of a `diff --git` line, each bare or C-quoted, or null when the line is not
 * one. Two bare paths with spaces are ambiguous on this line alone; like git, the symmetric split
 * (`a/P b/P`) wins, and for a rename the `rename from`/`rename to` and `---`/`+++` lines that follow
 * override these values.
 */
function parseDiffGit(line: string): { a: string; b: string } | null {
  if (!line.startsWith(DIFF_GIT)) return null;
  const rest = line.slice(DIFF_GIT.length);
  let a: string | null = null;
  let b: string | null = null;
  if (rest.startsWith('"')) {
    const q = readQuoted(rest, 0);
    if (!q || rest[q.end] !== ' ') return null;
    a = q.value;
    b = unquote(rest.slice(q.end + 1));
  } else if (rest.endsWith('"')) {
    // bare a/ path, quoted b/ path: the quoted string that runs exactly to the end of the line.
    for (let i = rest.indexOf(' "'); i >= 0; i = rest.indexOf(' "', i + 1)) {
      const q = readQuoted(rest, i + 1);
      if (q && q.end === rest.length) {
        a = rest.slice(0, i);
        b = q.value;
        break;
      }
    }
  } else {
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest[half] === ' ' && rest.slice(2, half) === rest.slice(half + 3)) {
      a = rest.slice(0, half);
      b = rest.slice(half + 1);
    } else {
      const m = /^(a\/.+?) (b\/.+)$/.exec(rest);
      a = m?.[1] ?? null;
      b = m?.[2] ?? null;
    }
  }
  const ap = a === null ? null : stripPrefix(a, 'a/');
  const bp = b === null ? null : stripPrefix(b, 'b/');
  return ap === null || bp === null ? null : { a: ap, b: bp };
}

/**
 * Splits a multi-file unified diff into one ChangedFile per `diff --git` stanza, plus one extra
 * entry per path a stanza touches besides its destination. `git diff` detects renames by default
 * (and copies with -C), so `rename from .github/workflows/ci.yml` / `rename to src/ci.ts` removes a
 * CI file even though the stanza's destination is in src/. The source path of every rename or copy
 * (the `rename from` / `copy from` line, else the `a/` path when it differs from `b/`) is therefore
 * emitted as its own ChangedFile, with `source` set and a header-only diff (no hunks, so added lines
 * are never counted twice). Oracles that ask "which paths did this run touch" see both sides.
 *
 * Paths are read the way git writes them (round 6): bare or C-quoted (`"b/\303\251.ts"`, the
 * default for non-ASCII and special characters), with the TAB git appends after a path containing a
 * space removed, so every stanza starts its own entry and every path is the real file name. *
 * The parser fails closed. A `diff --git` line whose paths lack the `a/` / `b/` prefixes (git's
 * output under `diff.noprefix` or `diff.mnemonicPrefix`, which use none or `i/ w/ c/ o/`), or a
 * `--- ` / `+++ ` / `@@` line before any `diff --git` line (a plain `diff -u` patch), starts an
 * entry whose path is `UNPARSED_PATH_PREFIX` + the raw line. That path is outside every edit
 * allow-list, so an oracle never reads a diff it cannot parse as a clean one.
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const lines = diff.split('\n');
  const files: ChangedFile[] = [];
  let current: {
    path: string;
    aPath: string;
    from?: { kind: 'rename' | 'copy'; path: string };
    oldHeader?: string | null;
    lines: string[];
    headerEnd: number | null;
    inHunks: boolean;
    /** Fail-closed entry: no later header line may change its path. */
    unparsed?: boolean;
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
    const header = parseDiffGit(line);
    if (header) {
      flush();
      // Prefer the `b/` path; a deletion's `+++ /dev/null` keeps it (the --- / +++ handling below).
      current = { path: header.b, aPath: header.a, lines: [line], headerEnd: null, inHunks: false };
      continue;
    }
    if (line.startsWith(DIFF_GIT) || (!current && BARE_FILE_LINE.test(line))) {
      // A stanza this parser cannot read: never drop it, and never fold it into the previous file.
      flush();
      const path = UNPARSED_PATH_PREFIX + line;
      current = { path, aPath: path, lines: [line], headerEnd: null, inHunks: false, unparsed: true };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (current.unparsed) continue;
    if (current.headerEnd === null) {
      // Extended header lines end at the first `--- `, `@@` or `Binary files` line.
      if (line.startsWith('--- ') || line.startsWith('@@') || line.startsWith('Binary files ')) {
        current.headerEnd = current.lines.length - 1;
      } else {
        const from = RENAME_OR_COPY_FROM.exec(line);
        const fromPath = from?.[2] ? unquote(from[2]) : null;
        if (from?.[1] && fromPath) current.from = { kind: from[1] as 'rename' | 'copy', path: fromPath };
        const to = RENAME_OR_COPY_TO.exec(line);
        const toPath = to?.[2] ? unquote(to[2]) : null;
        if (toPath) current.path = toPath;
      }
    }
    // `--- a/` and `+++ b/` are path headers only before the file's first `@@`. Inside a hunk, an
    // added line `++ b/README.md` reads `+++ b/README.md` (and a removed `-- a/x` reads `--- a/x`);
    // treating those as headers would let an added line rename the file the oracles see.
    if (line.startsWith('@@')) current.inHunks = true;
    if (current.inHunks) continue;
    if (line.startsWith('--- ')) {
      current.oldHeader = headerPath(line.slice(4), 'a/');
      if (current.oldHeader !== null) current.aPath = current.oldHeader;
    } else if (line.startsWith('+++ ')) {
      // A pure deletion has `+++ /dev/null`: keep the old path so the oracle still sees the file.
      const newPath = headerPath(line.slice(4), 'b/');
      if (newPath !== null) current.path = newPath;
      else if (current.oldHeader) current.path = current.oldHeader;
    }
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
