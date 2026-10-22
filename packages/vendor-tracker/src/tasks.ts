// The tracker's task prompts (tasks/prompts.json, PLAN 5.9) as DomainTasks with a grader.
import type { DomainTask, TaskGrade } from '@fiks/interfaces';
import PROMPTS from '../tasks/prompts.json' with { type: 'json' };
import type { StoredComment, StoredIssue } from './model.ts';

export interface StateCheck {
  key: string;
  field: 'state' | 'labels' | 'assignees' | 'comment_count';
  equals: unknown;
}

export interface TaskSpec {
  id: string;
  prompt: string;
  answerIncludes: string[];
  stateChecks: StateCheck[];
}

export const TASK_SPECS: readonly TaskSpec[] = PROMPTS.tasks as TaskSpec[];

const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ');

function fieldOf(state: { issues: StoredIssue[]; comments: StoredComment[] }, c: StateCheck): unknown {
  const issue = state.issues.find((i) => i.key === c.key);
  if (!issue) return undefined;
  if (c.field === 'comment_count') return state.comments.filter((x) => x.issue_key === c.key).length;
  return issue[c.field];
}

/** Grades an agent's final answer and the vendor state after the task. */
export function gradeTask(spec: TaskSpec, answer: string, state: unknown): TaskGrade {
  const missing = spec.answerIncludes.filter((t) => !norm(answer).includes(norm(t)));
  const s = state as { issues: StoredIssue[]; comments: StoredComment[] };
  const wrong = spec.stateChecks.filter((c) => JSON.stringify(fieldOf(s, c)) !== JSON.stringify(c.equals));
  if (wrong.length) {
    const what = wrong.map((c) => `${c.key}.${c.field} = ${JSON.stringify(fieldOf(s, c))}`).join('; ');
    return { pass: false, outcome: 'wrong_state', reason: `expected state not reached: ${what}` };
  }
  if (missing.length)
    return { pass: false, outcome: 'wrong_answer', reason: `answer lacks ${missing.join(', ')}` };
  return { pass: true, outcome: 'pass', reason: 'answer and state match' };
}

export const TASKS: DomainTask[] = TASK_SPECS.map((spec) => ({
  id: spec.id,
  prompt: spec.prompt,
  grade: (answer, state) => gradeTask(spec, answer, state),
}));
