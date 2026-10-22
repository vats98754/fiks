import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectInDiff, detectInSource } from '../src/ast.ts';
import { RECORDED_IDS } from './support.ts';

const dPatch = (n: number) =>
  readFileSync(new URL(`../../cli/test/oracles/D${n}.patch`, import.meta.url), 'utf8');

describe('AST detectors', () => {
  it('flags a network call', () => {
    const f = detectInSource("await fetch('http://x');");
    expect(f.some((x) => x.kind === 'network-call')).toBe(true);
  });

  it('flags an env read', () => {
    const f = detectInSource('const t = process.env.GH_TOKEN;');
    expect(f.some((x) => x.kind === 'env-read')).toBe(true);
  });

  it('flags dynamic exec', () => {
    const f = detectInSource("child_process.execSync('rm -rf /');");
    expect(f.some((x) => x.kind === 'dynamic-exec')).toBe(true);
  });

  it('flags a special-case on a recorded id but not on an unrelated literal', () => {
    const hit = detectInSource("if (args.id === 'p-1005') return cached;", RECORDED_IDS);
    expect(hit.some((x) => x.kind === 'recorded-id-special-case')).toBe(true);
    const miss = detectInSource("if (args.id === 'z-0000') return cached;", RECORDED_IDS);
    expect(miss.some((x) => x.kind === 'recorded-id-special-case')).toBe(false);
  });

  it('does not flag a payload that is only inside a string or comment', () => {
    const f = detectInSource("const note = 'please call fetch and read process.env'; // fetch here");
    expect(f.length).toBe(0);
  });

  it('finds nothing in any D1-D5 legitimate fix', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(detectInDiff(dPatch(n), RECORDED_IDS), `D${n}`).toEqual([]);
    }
  });
});
