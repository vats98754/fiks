// Differential input generator for TRK-DEV-1 (PLAN 3.0 criterion 2): seeded tool inputs over the
// tools that read the drifted endpoint (list_comments) and a write that feeds it (add_comment).
// Self-contained and deterministic: `generate(seed, n)` returns the same inputs for the same seed.

export interface GeneratedInput {
  tool: 'list_comments' | 'add_comment';
  args: Record<string, unknown>;
}

/** Original-catalog issue keys (TRK-101 .. TRK-120) plus one unknown key (invalid input). */
const KEYS = [...Array.from({ length: 20 }, (_, i) => `TRK-${101 + i}`), 'TRK-999'];

const BODIES = [
  'Looking into it.',
  'Same here on the latest build.',
  'Fixed by the last deploy?',
  'ünïcödé ✓',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(seed: number, n: number): GeneratedInput[] {
  const r = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const out: GeneratedInput[] = [];
  for (let i = 0; i < n; i++) {
    const key = pick(KEYS);
    out.push(
      r() < 0.75
        ? { tool: 'list_comments', args: { issue_key: key } }
        : { tool: 'add_comment', args: { issue_key: key, body: pick(BODIES) } },
    );
  }
  return out;
}
