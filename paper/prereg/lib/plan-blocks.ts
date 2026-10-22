// Splits PLAN.md sections into rule blocks for the verbatim check (check-prereg.ts).
// A block is: one heading (text without the #'s), one table row (separator rows skipped), one
// fenced code block, one list item with its wrapped continuation lines, or one paragraph.

export interface Block {
  section: string;
  kind: 'heading' | 'row' | 'code' | 'item' | 'para';
  /** 1-based line in the source file. */
  line: number;
  text: string;
}

const HEADING = /^(#+)\s+(.*)$/;
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s/;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s/;
const TABLE_SEPARATOR = /^\|[\s|:-]+\|$/;

/** Collapse every whitespace run to one space and trim (the only normalisation). */
export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Lines of the numbered section `id` (e.g. "3", "5.5"), from its heading up to (not including) the
 * next heading of the same or a higher level. Returns the 0-based start index too.
 */
export function sectionLines(md: string, id: string): { start: number; lines: string[] } {
  const lines = md.split('\n');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i] as string);
    if (h === null) continue;
    const num = NUMBERED.exec(h[2] as string);
    if (num !== null && num[1] === id) {
      start = i;
      level = (h[1] as string).length;
      break;
    }
  }
  if (start < 0) throw new Error(`section ${id} not found`);
  let end = lines.length;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.trimStart().startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const h = HEADING.exec(l);
    if (h !== null && (h[1] as string).length <= level) {
      end = i;
      break;
    }
  }
  return { start, lines: lines.slice(start, end) };
}

export function blocksOf(md: string, id: string): Block[] {
  const { start, lines } = sectionLines(md, id);
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur !== null) blocks.push({ ...cur, text: normalize(cur.text) });
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = start + i + 1;
    const t = raw.trim();
    if (t.startsWith('```')) {
      flush();
      const body: string[] = [raw];
      let j = i + 1;
      while (j < lines.length && !(lines[j] as string).trim().startsWith('```')) {
        body.push(lines[j] as string);
        j++;
      }
      if (j < lines.length) body.push(lines[j] as string);
      blocks.push({ section: id, kind: 'code', line, text: normalize(body.join('\n')) });
      i = j;
      continue;
    }
    if (t === '' || t === '---') {
      flush();
      continue;
    }
    const h = HEADING.exec(raw);
    if (h !== null) {
      flush();
      blocks.push({ section: id, kind: 'heading', line, text: normalize(h[2] as string) });
      continue;
    }
    if (t.startsWith('|')) {
      flush();
      if (!TABLE_SEPARATOR.test(t)) blocks.push({ section: id, kind: 'row', line, text: normalize(t) });
      continue;
    }
    if (LIST_ITEM.test(raw)) {
      flush();
      cur = { section: id, kind: 'item', line, text: t };
      continue;
    }
    if (cur !== null) {
      cur.text += ` ${t}`;
    } else {
      cur = { section: id, kind: 'para', line, text: t };
    }
  }
  flush();
  return blocks;
}
