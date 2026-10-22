import { defineConfig } from 'vitest/config';

// R19 harness unit tests (realbugs/ is outside the root vitest projects):
//   pnpm vitest run --config realbugs/R19/harness/vitest.config.ts
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['*.test.ts'],
  },
});
