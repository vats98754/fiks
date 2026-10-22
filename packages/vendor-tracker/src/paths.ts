// Concrete property paths of one tracker call, shared by entityClass() and originEntity(). Pure:
// reads the call only (no contract, no proxy).
import type { DomainCall } from '@fiks/interfaces';

/** Top-level output fields per tool, used when the call carries no output. */
export const TRACKER_TOOL_FIELDS: Record<string, readonly string[]> = {
  search_issues: ['items', 'count', 'total'],
  get_issue: [
    'key',
    'title',
    'type',
    'state',
    'priority',
    'labels',
    'assignees',
    'reporter',
    'story_points',
    'created_at',
    'updated_at',
    'comment_count',
  ],
  list_comments: ['issue_key', 'items', 'count', 'total'],
  add_comment: ['comment_id', 'issue_key', 'author', 'created_at'],
  transition_issue: ['key', 'state', 'previous_state'],
  update_labels: ['key', 'labels'],
  assign_issue: ['key', 'assignees'],
};

export const TRACKER_TOOLS: readonly string[] = Object.keys(TRACKER_TOOL_FIELDS);

/** Child tools act on one parent issue, named by this argument. */
export const PARENT_ARG: Record<string, string> = {
  get_issue: 'key',
  list_comments: 'issue_key',
  add_comment: 'issue_key',
  transition_issue: 'key',
  update_labels: 'key',
  assign_issue: 'key',
};

/** The structured output of a call: `call.output` may be a tool result or the bare output. */
export function structured(call: DomainCall): Record<string, unknown> | undefined {
  const o = call.output as
    | { isError?: unknown; structuredContent?: unknown; content?: unknown }
    | undefined
    | null;
  if (!o || typeof o !== 'object') return undefined;
  if (o.isError === true) return undefined;
  if ('structuredContent' in o || 'content' in o) {
    const s = o.structuredContent;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : undefined;
  }
  return o as Record<string, unknown>;
}

/** Every concrete path of a JSON value: '' (root), `a`, `a.b`, `items[2]`, `items[2].key`, ... */
export function concretePaths(value: unknown, prefix = ''): string[] {
  const out: string[] = prefix ? [] : [''];
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const p = `${prefix}[${i}]`;
      out.push(p, ...concretePaths(v, p));
    });
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value as object).sort()) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.push(p, ...concretePaths((value as Record<string, unknown>)[k], p));
    }
  }
  return out;
}

export function pathsOf(call: DomainCall): string[] {
  const fields = TRACKER_TOOL_FIELDS[call.tool];
  if (!fields) throw new Error(`tracker: unknown tool ${call.tool}`);
  const s = structured(call);
  return s ? concretePaths(s) : ['', ...fields];
}

/** `items[3]...` on search_issues -> 3 (each search item is its own issue); else undefined. */
export function searchElement(tool: string, path: string): number | undefined {
  if (tool !== 'search_issues') return undefined;
  const m = /^items\[(\d+)\]/.exec(path);
  return m ? Number(m[1]) : undefined;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The S-grid query id of a search (collection-level origin unit): its arguments, canonical. */
export const queryId = (args: Record<string, unknown>) => `query:${canonical(args ?? {})}`;

export const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
