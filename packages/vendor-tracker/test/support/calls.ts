// Seeded random tracker tool calls over every tool, including invalid inputs.
import { CATALOG, TRACKER_TOOLS } from '../../src/index.ts';

const STATES = ['open', 'in_progress', 'resolved', 'closed'];
const TYPES = ['bug', 'task', 'feature'];

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 100 seeded calls over every tool, including invalid inputs (unknown keys, refused moves, bad names). */
export function randomCalls(seed: number, n: number): { tool: string; args: Record<string, unknown> }[] {
  const r = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const keys = [...CATALOG.map((i) => i.key), 'TRK-999'];
  const labels = ['frontend', 'backend', 'security', 'docs', 'triaged', 'perf', 'Bad Label'];
  const users = ['alice', 'bob', 'carol', 'dan', 'erin', 'frank', 'gus', 'Nope'];
  const words = ['login', 'cache', 'search', 'the', 'TRK-104', 'api', 'zzz', ''];
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  for (let i = 0; i < n; i++) {
    const tool = TRACKER_TOOLS[i % TRACKER_TOOLS.length] as string;
    let args: Record<string, unknown>;
    switch (tool) {
      case 'search_issues': {
        args = {};
        if (r() < 0.6) args.query = pick(words);
        if (r() < 0.4) args.type = pick(TYPES);
        if (r() < 0.4) args.state = pick(STATES);
        if (r() < 0.2) args.label = pick(labels);
        if (r() < 0.2) args.assignee = pick(users);
        break;
      }
      case 'get_issue':
        args = { key: pick(keys) };
        break;
      case 'list_comments':
        args = { issue_key: pick(keys) };
        break;
      case 'add_comment':
        args = { issue_key: pick(keys), body: r() < 0.1 ? '   ' : `Random note ${i} (${pick(words)})` };
        break;
      case 'transition_issue':
        args = { key: pick(keys), to: pick(STATES) };
        break;
      case 'update_labels':
        args = {
          key: pick(keys),
          ...(r() < 0.8 ? { add: [pick(labels)] } : {}),
          ...(r() < 0.5 ? { remove: [pick(labels)] } : {}),
        };
        break;
      default:
        args = { key: pick(keys), assignee: pick(users) };
    }
    calls.push({ tool, args });
  }
  return calls;
}
