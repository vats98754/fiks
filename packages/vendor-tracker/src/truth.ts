// Ground truth for the tracker tools (PLAN 3.0 criterion 5, 3.1 "Clean"): what each tracker-mcp
// tool should return for a call, computed from the vendor's own state only. `state` is the
// vendor's state right after the call: `Vendor.state` or the `/__admin/state` JSON (the same
// plain object). This module never imports the contracts package, the proxy package or any monitor
// (lint rule: ../biome.json; static check in test/static.test.ts).
import type { DomainCall, TruthResult } from '@fiks/interfaces';
import { ISSUE_STATES, NAME_RE } from './catalog.ts';
import {
  commentView,
  issueView,
  parseNameEdit,
  type SearchFilters,
  type StoredComment,
  type StoredIssue,
  searchIssues,
  summaryView,
  type VendorEvent,
} from './model.ts';

/** The part of `VendorState` truth reads. */
export interface TruthState {
  issues: readonly StoredIssue[];
  comments: readonly StoredComment[];
  events: readonly VendorEvent[];
}

type Actual = { kind: 'error' } | { kind: 'empty' } | { kind: 'data'; value: unknown };

/** A tool result (`{structuredContent, isError}`) or a bare structured output, classified. */
export function actualOf(output: unknown): Actual {
  if (output === undefined || output === null) return { kind: 'empty' };
  if (typeof output === 'object') {
    const o = output as { isError?: unknown; structuredContent?: unknown; content?: unknown };
    if (o.isError === true) return { kind: 'error' };
    if ('structuredContent' in o || 'content' in o) {
      return o.structuredContent === undefined || o.structuredContent === null
        ? { kind: 'empty' }
        : { kind: 'data', value: o.structuredContent };
    }
  }
  return { kind: 'data', value: output };
}

const isInstantString = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

function sameNumber(a: number, b: number): boolean {
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Paths where `actual` differs from `expected` under the semantic equality of PLAN 3.0: integers
 * exact, floats to 1e-9 relative, null = absent, key order ignored, arrays ordered, strings NFC,
 * timestamps as instants.
 */
export function semanticDiff(expected: unknown, actual: unknown, path = ''): string[] {
  const absent = (v: unknown) => v === undefined || v === null;
  if (absent(expected) && absent(actual)) return [];
  if (absent(expected) || absent(actual)) return [path];
  if (typeof expected === 'number' && typeof actual === 'number')
    return sameNumber(expected, actual) ? [] : [path];
  if (typeof expected === 'string' && typeof actual === 'string') {
    if (isInstantString(expected) && isInstantString(actual)) {
      return Date.parse(expected) === Date.parse(actual) ? [] : [path];
    }
    return expected.normalize('NFC') === actual.normalize('NFC') ? [] : [path];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return [path];
    return expected.flatMap((e, i) => semanticDiff(e, actual[i], `${path}[${i}]`));
  }
  if (
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
    return keys.flatMap((k) => semanticDiff(e[k], a[k], path ? `${path}.${k}` : k));
  }
  return Object.is(expected, actual) ? [] : [path];
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const INVALID = { inputValid: false, expected: null } as const;

function expectedFor(call: DomainCall, state: TruthState): { inputValid: boolean; expected: unknown } {
  const args = call.args ?? {};
  const issue = (k: unknown) => (typeof k === 'string' ? state.issues.find((i) => i.key === k) : undefined);
  switch (call.tool) {
    case 'search_issues': {
      const f: SearchFilters = {};
      for (const k of ['type', 'state', 'label', 'assignee'] as const) {
        if (args[k] === undefined) continue;
        if (typeof args[k] !== 'string') return INVALID;
        f[k] = args[k] as string;
      }
      if (args.query !== undefined) {
        if (typeof args.query !== 'string') return INVALID;
        f.q = args.query;
      }
      const matches = searchIssues(state.issues, f);
      if (typeof matches === 'string') return INVALID;
      const items = matches.map(summaryView);
      return { inputValid: true, expected: { items, count: items.length, total: items.length } };
    }
    case 'get_issue': {
      const i = issue(args.key);
      return i ? { inputValid: true, expected: issueView(i, state.comments) } : INVALID;
    }
    case 'list_comments': {
      const i = issue(args.issue_key);
      if (!i) return INVALID;
      const items = state.comments
        .filter((c) => c.issue_key === i.key)
        .map((c) => {
          const { issue_key: _k, ...rest } = commentView(c);
          return rest;
        });
      return {
        inputValid: true,
        expected: { issue_key: i.key, items, count: items.length, total: items.length },
      };
    }
    case 'add_comment': {
      const i = issue(args.issue_key);
      const body = str(args.body);
      if (!i || body === undefined || !body.trim()) return INVALID;
      // The comment this call stored: the one the tool named, else the latest with this body. An
      // id that names no stored comment (a lost write) has no true value.
      const actual = actualOf(call.output);
      const named =
        actual.kind === 'data' ? (actual.value as { comment_id?: unknown } | null)?.comment_id : undefined;
      const mine = (c: StoredComment) => c.issue_key === i.key && c.body === body;
      const stored =
        state.comments.find((c) => c.id === named && mine(c)) ??
        (named === undefined ? [...state.comments].reverse().find(mine) : undefined);
      return {
        inputValid: true,
        expected: {
          comment_id: stored?.id ?? null,
          issue_key: i.key,
          author: stored?.author ?? null,
          created_at: stored?.created_at ?? null,
        },
      };
    }
    case 'transition_issue': {
      const i = issue(args.key);
      const to = str(args.to);
      if (!i || to === undefined || !(ISSUE_STATES as readonly string[]).includes(to)) return INVALID;
      // The vendor logs every attempted move on a known issue; this call is the latest one to `to`.
      const ev = [...state.events]
        .reverse()
        .find((e) => e.kind === 'transition' && e.key === i.key && e.to === to);
      if (!ev?.ok) return INVALID;
      return { inputValid: true, expected: { key: i.key, state: ev.to, previous_state: ev.from } };
    }
    case 'update_labels': {
      const i = issue(args.key);
      if (!i || typeof parseNameEdit({ add: args.add ?? [], remove: args.remove ?? [] }) === 'string')
        return INVALID;
      return { inputValid: true, expected: { key: i.key, labels: [...i.labels] } };
    }
    case 'assign_issue': {
      const i = issue(args.key);
      const who = str(args.assignee);
      if (!i || who === undefined || !NAME_RE.test(who)) return INVALID;
      return { inputValid: true, expected: { key: i.key, assignees: [...i.assignees] } };
    }
    default:
      throw new Error(`tracker truth(): unknown tool ${call.tool}`);
  }
}

/**
 * What the tracker tool should have returned for `call`, from vendor ground truth. With
 * `call.output`, `mismatches` lists the paths where the output differs; for an invalid input an
 * error or an empty result counts as equal (PLAN 3.0).
 */
export function trackerTruth(call: DomainCall, state: unknown): TruthResult {
  const { inputValid, expected } = expectedFor(call, state as TruthState);
  if (call.output === undefined) return { inputValid, expected };
  const actual = actualOf(call.output);
  let mismatches: string[];
  if (!inputValid) mismatches = actual.kind === 'data' ? [''] : [];
  else if (actual.kind !== 'data') mismatches = [''];
  else mismatches = semanticDiff(expected, actual.value);
  return { inputValid, expected, mismatches };
}
