import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Container tests start per-attempt sandboxes (2 GB each, Docker Desktop has 6 GB): two at a time.
    maxWorkers: 2,
    sequence: { groupOrder: 2 },
    testTimeout: 120_000,
    hookTimeout: 60 * 60_000,
  },
});
