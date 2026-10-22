// Origin unit per concrete property path of one tracker call (PLAN 3.1 "Attribution"). Pure
// function of the call; reads no contract (lint rule in ../biome.json; static check in
// test/static.test.ts forbids importing the contracts or proxy package).
import type { DomainCall } from '@fiks/interfaces';
import { PARENT_ARG, pathsOf, queryId, searchElement, str, structured } from './paths.ts';

/**
 * - entity-level tools (get_issue): the issue;
 * - child tools (comments, labels, assignees, transitions): the parent issue, for every path;
 * - search_issues element paths (`items[i]...`): that element's own issue;
 * - search_issues collection-level paths ('', items, count, total): the S-grid query id.
 */
export function trackerOriginEntity(call: DomainCall): Record<string, string> {
  const out: Record<string, string> = {};
  const args = call.args ?? {};
  const s = structured(call);
  for (const path of pathsOf(call)) {
    if (call.tool === 'search_issues') {
      const i = searchElement(call.tool, path);
      const q = queryId(args);
      const items = s?.items as { key?: unknown }[] | undefined;
      out[path] = i === undefined ? q : (str(items?.[i]?.key) ?? `${q}#${i}`);
      continue;
    }
    const arg = PARENT_ARG[call.tool] as string;
    out[path] = str(args[arg]) ?? `issue:${JSON.stringify(args[arg] ?? null)}`;
  }
  return out;
}
