// Entity class per concrete property path of one tracker call (D12 cells): the issue's type x
// state, e.g. `bug:open`. The class is a property of the entity as catalogued (type and state as
// authored), so every call about an issue gets the same class whatever the call changed. Pure
// function of the call and the issue index; reads no contract.
import type { DomainCall } from '@fiks/interfaces';
import type { CatalogIssue } from './catalog.ts';
import { PARENT_ARG, pathsOf, searchElement, str, structured } from './paths.ts';

export type IssueIndex = (key: string) => Pick<CatalogIssue, 'type' | 'state'> | undefined;

export const classOf = (type: string, state: string) => `${type}:${state}`;

/**
 * - get_issue: the issue's class;
 * - child tools (comments, labels, assignees, transitions): the parent issue's class;
 * - search_issues element paths: the element's issue class; collection-level paths: the filter
 *   class (`<type|*>:<state|*>` when a type or state filter is given), else 'all';
 * - an issue the index does not know: the type and state the output reports, else 'unknown'.
 */
export function trackerEntityClass(call: DomainCall, index: IssueIndex): Record<string, string> {
  const out: Record<string, string> = {};
  const args = call.args ?? {};
  const s = structured(call);
  const classOfKey = (key: unknown, reported?: { type?: unknown; state?: unknown }) => {
    const hit = typeof key === 'string' ? index(key) : undefined;
    if (hit) return classOf(hit.type, hit.state);
    const t = str(reported?.type);
    const st = str(reported?.state);
    return t && st ? classOf(t, st) : 'unknown';
  };
  for (const path of pathsOf(call)) {
    if (call.tool === 'search_issues') {
      const i = searchElement(call.tool, path);
      if (i === undefined) {
        const t = str(args.type);
        const st = str(args.state);
        out[path] = t || st ? classOf(t ?? '*', st ?? '*') : 'all';
      } else {
        const item = (s?.items as { key?: unknown; type?: unknown; state?: unknown }[] | undefined)?.[i];
        out[path] = classOfKey(item?.key, item);
      }
      continue;
    }
    const key = args[PARENT_ARG[call.tool] as string];
    out[path] = classOfKey(key, call.tool === 'get_issue' ? s : undefined);
  }
  return out;
}
