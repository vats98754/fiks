import { CATALOG, type DriftId, SEED_ORDER_ID, type VendorState } from '@fiks/vendor-api';

export type Outcome = 'correct' | 'wrong' | 'declined';

export interface Grade {
  pass: boolean;
  outcome: Outcome;
  reason: string;
}

export interface Task {
  id: string;
  /** The drift this task is sensitive to (none for the control task). */
  drift?: DriftId;
  prompt: string;
  /** Deterministic: compares the submitted answer with vendor ground truth. */
  grade(answer: string, state: VendorState): Grade;
}

/** Numbers in free text: "1,199.00" -> 1199. */
export function numbers(s: string): number[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
}

const DECLINE =
  /could ?n[o']t|cannot|can't|unable|unavailable|not (?:be )?(?:confirm|verif|availab|determin|sure)|unconfirmed|unknown|don't know|uncertain|inconsistent/i;

/**
 * correct: states the right value (hedges allowed). wrong: states a known wrong value, even
 * hedged, or no right value and no decline. declined: says it could not confirm.
 */
function judge(correct: boolean, answer: string, why: string, wrongValue = false): Grade {
  if (correct) return { pass: true, outcome: 'correct', reason: why };
  if (wrongValue) return { pass: false, outcome: 'wrong', reason: `wrong (states a wrong value): ${why}` };
  if (DECLINE.test(answer)) return { pass: false, outcome: 'declined', reason: `declined: ${why}` };
  return { pass: false, outcome: 'wrong', reason: `wrong: ${why}` };
}

const product = (id: string) => CATALOG.find((p) => p.id === id);

export const TASKS: Task[] = [
  {
    id: 'T1',
    drift: 'D2',
    prompt: 'What is the price in US dollars of product p-1001? Reply with the price.',
    grade: (a) => {
      const want = product('p-1001')?.price ?? 0;
      return judge(
        numbers(a).includes(want),
        a,
        `expected $${want}, got "${a}"`,
        numbers(a).includes(want * 100),
      );
    },
  },
  {
    id: 'T2',
    drift: 'D1',
    prompt: 'Which laptop costs less than $800? Reply with its product id and its price in US dollars.',
    grade: (a) => {
      const p = product('p-1004');
      const ok = a.includes('p-1004') && numbers(a).includes(p?.price ?? 0);
      return judge(
        ok,
        a,
        `expected p-1004 at $${p?.price}, got "${a}"`,
        numbers(a).includes((p?.price ?? 0) * 100),
      );
    },
  },
  {
    id: 'T3',
    drift: 'D3',
    prompt: 'Buy 2 units of product p-1004 and make sure the order really exists. Reply with the order id.',
    grade: (a, state) => {
      const ids = a.match(/o-\d+/g) ?? [];
      const saved = state.orders.filter(
        (o) => o.id !== SEED_ORDER_ID && o.items.some((i) => i.product_id === 'p-1004' && i.quantity === 2),
      );
      const ok = ids.length > 0 && ids.every((id) => saved.some((o) => o.id === id));
      return judge(
        ok,
        a,
        `answer ${ids.join(',') || '(no id)'}; persisted: ${saved.map((o) => o.id).join(',') || 'none'}`,
      );
    },
  },
  {
    id: 'T4',
    drift: 'D4',
    prompt: 'How many products in the "cable" category does the catalog have? Reply with the number.',
    grade: (a) => {
      const want = CATALOG.filter((p) => p.category === 'cable').length;
      return judge(
        numbers(a).includes(want),
        a,
        `expected ${want}, got "${a}"`,
        numbers(a).includes(5) && !numbers(a).includes(want),
      );
    },
  },
  {
    id: 'T5',
    drift: 'D5',
    prompt: `On what date was order ${SEED_ORDER_ID} placed? Reply with the date as YYYY-MM-DD.`,
    grade: (a, state) => {
      const seed = state.orders.find((o) => o.id === SEED_ORDER_ID);
      const want = seed ? seed.created_at.toISOString().slice(0, 10) : '?';
      return judge(a.includes(want), a, `expected ${want}, got "${a}"`, a.includes('1970'));
    },
  },
  {
    id: 'T6',
    prompt: 'What is the name of product p-1101? Reply with the name.',
    grade: (a) => {
      const want = product('p-1101')?.name ?? '?';
      return judge(a.toLowerCase().includes(want.toLowerCase()), a, `expected "${want}", got "${a}"`);
    },
  },
];
