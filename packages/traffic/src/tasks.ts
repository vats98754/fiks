// The held-out task prompts (PLAN 5.9): 20 per domain. A domain's prompts come from, in order,
// `--prompts <file>`, then packages/traffic/tasks/<domain>.json, then the registered
// `Domain.tasks` (the tracker's 20 prompts live in packages/vendor-tracker/tasks/prompts.json).
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { canonical, sha256 } from './canonical.ts';

export interface TrafficTask {
  id: string;
  prompt: string;
}

export interface TaskSet {
  domain: string;
  /** Where the prompts came from: a file path (repo-relative when inside the repo) or `Domain.tasks`. */
  source: string;
  /** sha256 of the canonical [{id, prompt}] list (selection applied). */
  sha256: string;
  tasks: TrafficTask[];
}

const PKG = new URL('..', import.meta.url).pathname;
const ROOT = resolve(PKG, '../..');

/** packages/traffic/tasks/<domain>.json when it exists. */
export function defaultTaskFile(domain: string): string | undefined {
  const f = join(PKG, 'tasks', `${domain}.json`);
  return existsSync(f) ? f : undefined;
}

function checked(domain: string, source: string, tasks: TrafficTask[]): TaskSet {
  if (tasks.length === 0) throw new Error(`${source}: no task prompts for ${domain}`);
  const seen = new Set<string>();
  for (const t of tasks) {
    if (typeof t.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t.id))
      throw new Error(`${source}: invalid task id ${JSON.stringify(t.id)}`);
    if (seen.has(t.id)) throw new Error(`${source}: duplicate task id ${t.id}`);
    seen.add(t.id);
    if (typeof t.prompt !== 'string' || !t.prompt.trim())
      throw new Error(`${source}: task ${t.id} has no prompt`);
  }
  const list = tasks.map((t) => ({ id: t.id, prompt: t.prompt }));
  return { domain, source, sha256: sha256(canonical(list)), tasks: list };
}

/** Reads `{domain?, tasks: [{id, prompt, ...}]}`; other fields (graders) are ignored. */
export function loadTaskFile(file: string, domain: string): TaskSet {
  const j = JSON.parse(readFileSync(file, 'utf8')) as { domain?: string; tasks?: TrafficTask[] };
  if (j.domain !== undefined && j.domain !== domain)
    throw new Error(`${file} holds prompts for domain ${j.domain}, not ${domain}`);
  if (!Array.isArray(j.tasks)) throw new Error(`${file}: no "tasks" array`);
  const rel = relative(ROOT, resolve(file));
  return checked(domain, rel.startsWith('..') ? resolve(file) : rel, j.tasks);
}

export function tasksFromDomain(d: {
  id: string;
  tasks: readonly { id: string; prompt: string }[];
}): TaskSet {
  return checked(d.id, 'Domain.tasks', [...d.tasks]);
}

/** The task set for a domain (see the header for the order of sources). */
export function resolveTasks(
  d: { id: string; tasks: readonly { id: string; prompt: string }[] },
  file?: string,
): TaskSet {
  if (file) return loadTaskFile(file, d.id);
  const own = defaultTaskFile(d.id);
  return own ? loadTaskFile(own, d.id) : tasksFromDomain(d);
}

/** Keeps `ids` (in the set's order); unknown ids throw. No ids = all. */
export function selectTasks(set: TaskSet, ids?: readonly string[]): TaskSet {
  if (!ids?.length) return set;
  const unknown = ids.filter((id) => !set.tasks.some((t) => t.id === id));
  if (unknown.length) throw new Error(`unknown task id(s) for ${set.domain}: ${unknown.join(', ')}`);
  return checked(
    set.domain,
    set.source,
    set.tasks.filter((t) => ids.includes(t.id)),
  );
}
