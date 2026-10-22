// Synthetic extended catalogs for tests (a stand-in for the A0 catalog author's batches). Values
// are deterministic; every shop price lies in [25, 1825] unless a test plants another entity.
import { writeFileSync } from 'node:fs';

const ADJ = ['Arc', 'Brisk', 'Cobalt', 'Delta', 'Ember', 'Flint', 'Glade', 'Harbor', 'Iris', 'Juno'];
const NOUN = ['Hub', 'Stand', 'Mouse', 'Lamp', 'Case', 'Router', 'Panel', 'Speaker', 'Mic', 'Drive'];
const CATEGORIES = ['laptop', 'monitor', 'cable', 'dock', 'keyboard', 'webcam', 'headphones', 'tablet'];

export const pad = (i: number) => String(i).padStart(4, '0');

/** `n` shop products px-s0001.. in two author batches (first half b01, second half b02). */
export function shopExtension(n = 750): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    return {
      id: `px-s${pad(i)}`,
      name: `${ADJ[i % ADJ.length]} ${NOUN[Math.floor(i / ADJ.length) % NOUN.length]} ${i}`,
      category: CATEGORIES[i % CATEGORIES.length],
      price: 25 + ((i * 37) % 1800) + (i % 2 ? 0.5 : 0),
      currency: 'USD',
      stock: i % 7,
      authorBatch: i <= n / 2 ? 'b01' : 'b02',
    };
  });
}

const TYPES = ['bug', 'task', 'feature'];
const STATES = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/** `n` tracker issues TX-S0001.. in two author batches. */
export function trackerExtension(n = 750): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const at = new Date(Date.UTC(2026, 7, 1) + i * 60_000).toISOString();
    return {
      key: `TX-S${pad(i)}`,
      title: `${ADJ[i % ADJ.length]} ${NOUN[Math.floor(i / ADJ.length) % NOUN.length]} issue ${i}`,
      type: TYPES[i % TYPES.length],
      state: STATES[i % STATES.length],
      priority: PRIORITIES[i % PRIORITIES.length],
      labels: i % 3 ? ['backend'] : [],
      assignees: i % 4 ? [] : ['gina'],
      reporter: 'hal',
      story_points: i % 5 ? i % 8 : null,
      created_at: at,
      updated_at: at,
      comments: [],
      authorBatch: i <= n / 2 ? 'b01' : 'b02',
    };
  });
}

export function writeCatalog(file: string, entities: Record<string, unknown>[]): string {
  writeFileSync(file, `${JSON.stringify({ entities }, null, 2)}\n`);
  return file;
}
