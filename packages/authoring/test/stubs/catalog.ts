// Stub catalog author: 25 entities per batch, named after the call index (so a test can check that
// no batch prompt carries another batch's output).
import type { StubAuthor } from '../../src/stub.ts';

const author: StubAuthor = (req) => {
  const tracker = /Tracker API/.test(req.prompt);
  const entities = Array.from({ length: 25 }, (_, i) =>
    tracker
      ? {
          title: `Stub issue ${req.index}-${i}`,
          type: 'bug',
          state: 'open',
          priority: 'medium',
          labels: ['backend'],
          assignees: [],
          reporter: 'stub',
          story_points: i % 5 === 0 ? null : i,
          created_at: '2026-08-01T10:00:00.000Z',
          updated_at: '2026-08-02T10:00:00.000Z',
          comments: [],
        }
      : {
          name: `Stub Widget ${req.index}-${i}`,
          category: 'widget',
          price: 30 + i,
          currency: 'USD',
          stock: i,
        },
  );
  return { structured: { entities } };
};

export default author;
