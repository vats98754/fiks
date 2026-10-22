// TRK-DEV-1 (dev only, never confirmatory): the tracker vendor ships API version 2026-10-01, in
// which the comment list of `GET /issues/{key}/comments` moves from `items` to `comments`. The
// OpenAPI document is not updated, the status stays 200 and `total` is unchanged.
// Self-contained transform module (packages/injector contract: default export
// {description, setHeaders?, response(req, res, ctx)}; only `import type` allowed).

interface Req {
  method: string;
  path: string;
}

interface Res {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export default {
  description: 'comments list envelope renamed: items -> comments (API 2026-10-01, spec unchanged)',
  setHeaders: { 'tracker-api-version': '2026-10-01' },
  response(_req: Req, res: Res): Res | undefined {
    if (res.status !== 200) return undefined;
    const body = JSON.parse(res.body) as { items?: unknown };
    if (!('items' in body)) return undefined;
    const { items, ...rest } = body;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      out[k] = v;
      if (k === 'issue_key') out.comments = items;
    }
    if (!('comments' in out)) out.comments = items;
    return { ...res, body: JSON.stringify(out) };
  },
};
