import { defineProject } from 'vitest/config';

// fixtures/ holds sealed hidden tests and test sets that run only inside a target repo's
// grading container, never in fiks's own suite.
export default defineProject({
  test: {
    name: '@fiks/heldout',
    include: ['test/**/*.test.ts'],
  },
});
