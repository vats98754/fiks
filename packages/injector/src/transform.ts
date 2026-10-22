// The module contract every InjectorRule.transform implements. A transform module is
// self-contained: besides `import type` it imports nothing (only its own bytes are hashed into the
// rule hash, so a shared helper could change behaviour without changing the hash; the validator
// enforces this).

/** The request the injector forwarded upstream. Header names are lower-case. */
export interface InjectorRequest {
  method: string;
  /** Pathname without the query string, e.g. `/products/p-1001`. */
  path: string;
  query: URLSearchParams;
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
}

/** The upstream response as the injector received it (or as a transform returns it). */
export interface InjectorResponse {
  status: number;
  /** Lower-case header names; hop-by-hop headers and content-length are already removed. */
  headers: Record<string, string>;
  /** UTF-8 body text. */
  body: string;
}

export interface TransformContext {
  /** The rule's clock: the frozen instant when `clockFrozen`, else the wall clock. */
  now(): Date;
  /** Per-injector-instance state (a restarted injector starts empty). */
  state: Map<string, unknown>;
}

export interface InjectorTransform {
  /** One line: what the third-party change does. */
  description: string;
  /**
   * Response header values set on every response through the injector, matched or not (e.g. the
   * vendor's version header after a release). Applied after `response`.
   */
  setHeaders?: Readonly<Record<string, string>>;
  /**
   * Rewrites the response of a request that matched the rule. Returning `undefined` passes the
   * upstream response through unchanged. Must be deterministic given (request sequence, clock).
   */
  response(req: InjectorRequest, res: InjectorResponse, ctx: TransformContext): InjectorResponse | undefined;
}
