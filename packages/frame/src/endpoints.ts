// Which upstream endpoint each tool calls (method and a sample path), so a per-drift enumeration
// keeps the tools that touch the drifted endpoint (PLAN 5.7). Read from the tool servers' vendor
// clients at their bases (shop-mcp src/tools/*.ts at seed-v1/base-shop; tracker-mcp
// src/tools/*.ts at bfc0e1e). A tool not listed here is kept (it might touch the endpoint).

export interface ToolEndpoint {
  method: string;
  /** A concrete sample path the tool requests (ids replaced by a placeholder). */
  path: string;
}

export const TOOL_ENDPOINTS: Record<string, Record<string, ToolEndpoint>> = {
  shop: {
    search_products: { method: 'GET', path: '/products' },
    get_product: { method: 'GET', path: '/products/x-1' },
    create_order: { method: 'POST', path: '/orders' },
    get_order: { method: 'GET', path: '/orders/o-1' },
  },
  tracker: {
    search_issues: { method: 'GET', path: '/issues' },
    get_issue: { method: 'GET', path: '/issues/X-1' },
    list_comments: { method: 'GET', path: '/issues/X-1/comments' },
    add_comment: { method: 'POST', path: '/issues/X-1/comments' },
    transition_issue: { method: 'POST', path: '/issues/X-1/transitions' },
    assign_issue: { method: 'POST', path: '/issues/X-1/assignees' },
    update_labels: { method: 'POST', path: '/issues/X-1/labels' },
  },
};

export interface RuleMatch {
  method: string;
  pathPattern: string;
}

/** The injector rule's matcher (packages/injector rule format): `*` or `GET|POST`, regex on the path. */
export function ruleMatches(match: RuleMatch, method: string, path: string): boolean {
  const methods = match.method === '*' ? null : match.method.toUpperCase().split('|');
  if (methods && !methods.includes(method.toUpperCase())) return false;
  return new RegExp(match.pathPattern).test(path);
}

/** True when `tool` calls an endpoint the rule rewrites (unknown tools: true). */
export function toolTouches(domain: string, tool: string, match: RuleMatch): boolean {
  const ep = TOOL_ENDPOINTS[domain]?.[tool];
  if (!ep) return true;
  return ruleMatches(match, ep.method, ep.path);
}

/** True when `tool` writes upstream (a POST/PUT/PATCH/DELETE endpoint). */
export function isWriteTool(domain: string, tool: string): boolean {
  const m = TOOL_ENDPOINTS[domain]?.[tool]?.method;
  return m !== undefined && m !== 'GET';
}
