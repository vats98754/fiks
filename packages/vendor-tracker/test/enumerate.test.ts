import { describe, expect, test } from 'vitest';
import { CATALOG, TRACKER_GRID_SIZE, trackerDomain, trackerEnumerate } from '../src/index.ts';

const EXT = new URL('./fixtures/extended-sample.json', import.meta.url).pathname;

describe('trackerEnumerate', () => {
  test('S-ext, S-grid and S-write on the original catalog; deterministic per seed', () => {
    const rows = trackerDomain.enumerate({ catalog: 'original', seed: 1 });
    const by = (s: string) => rows.filter((r) => r.stratum === s);
    expect(by('S-ext')).toHaveLength(CATALOG.length * 2);
    expect(by('S-grid')).toHaveLength(TRACKER_GRID_SIZE);
    expect(by('S-write')).toHaveLength(CATALOG.length * 4);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length);
    expect(trackerDomain.enumerate({ catalog: 'original', seed: 1 })).toEqual(rows);
    expect(trackerDomain.enumerate({ catalog: 'original', seed: 2 })).not.toEqual(rows);
    const grid = by('S-grid').map((r) => r.args);
    expect(grid.some((a) => 'state' in a && 'type' in a)).toBe(true);
    expect(grid.some((a) => 'label' in a)).toBe(true);
    // S-write: every write is followed by its read of the same issue.
    const w = by('S-write');
    for (let i = 0; i < w.length; i += 2) {
      const [write, read] = [w[i], w[i + 1]];
      expect(['add_comment', 'transition_issue']).toContain(write?.tool);
      expect(read?.tool).toBe(write?.tool === 'add_comment' ? 'list_comments' : 'get_issue');
      expect(Object.values(read?.args ?? {})[0]).toBe(Object.values(write?.args ?? {})[0]);
    }
  });

  test('extended-only enumerates extended entities only', () => {
    const rows = trackerEnumerate({ catalog: 'extended-only', seed: 's', extended: EXT });
    const keys = rows
      .flatMap((r) => [r.args.key, r.args.issue_key])
      .filter((k): k is string => typeof k === 'string');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => !k.startsWith('TRK-'))).toBe(true);
    expect(
      trackerEnumerate({ catalog: 'extended-only', seed: 's', extended: EXT, stratum: 'S-ext' }),
    ).toHaveLength(10);
  });
});
