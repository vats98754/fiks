// An attempt's output folder (results never overwrite, P6): AttemptRecord, CandidateRecords with
// their diffs, ReproTestRecords, the event log, the RerecordLog, prompts, transcripts, gate logs.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AttemptRecord,
  CandidateRecord,
  CandidateStage,
  ReproTestRecord,
  RunKey,
} from '@fiks/interfaces';

export type ArmEventType =
  | 'attempt_started'
  | 'session_started'
  | 'session_ended'
  | 'candidate'
  | 'gate'
  | 'would_open_pr'
  | 'ci'
  | 'revision'
  | 'f_check'
  | 'f_feedback'
  | 'attempt_ended';

export interface ArmEvent {
  ts: string;
  type: ArmEventType;
  session?: number;
  data?: Record<string, unknown>;
}

export class AttemptOutput {
  private candidateN = 0;
  readonly candidateIds: string[] = [];
  constructor(
    readonly dir: string,
    readonly runKey: RunKey,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Refuses an existing, non-empty folder: a run key's results are written once. */
  static create(dir: string, runKey: RunKey, now?: () => Date): AttemptOutput {
    if (existsSync(dir) && readdirSync(dir).length > 0) {
      throw new Error(`results for this run key already exist at ${dir}; results are never overwritten`);
    }
    mkdirSync(dir, { recursive: true });
    return new AttemptOutput(dir, runKey, now);
  }

  path(...p: string[]): string {
    return join(this.dir, ...p);
  }

  write(rel: string, content: string | Buffer): string {
    const f = this.path(rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, content);
    return f;
  }

  event(type: ArmEventType, data?: Record<string, unknown>, session?: number): ArmEvent {
    const e: ArmEvent = {
      ts: this.now().toISOString(),
      type,
      ...(session ? { session } : {}),
      ...(data ? { data } : {}),
    };
    appendFileSync(this.path('events.jsonl'), `${JSON.stringify(e)}\n`);
    return e;
  }

  /** Stores a candidate diff (P11) and its CandidateRecord. */
  candidate(diff: string, stage: CandidateStage): CandidateRecord {
    const id = `c${String(++this.candidateN).padStart(3, '0')}-${stage}`;
    const diffPath = this.write(join('candidates', `${id}.diff`), diff);
    const rec: CandidateRecord = {
      id,
      runKey: this.runKey,
      stage,
      diffSha: createHash('sha256').update(diff).digest('hex'),
      diffPath,
    };
    appendFileSync(this.path('candidates.jsonl'), `${JSON.stringify(rec)}\n`);
    this.candidateIds.push(id);
    return rec;
  }

  reproTest(rec: ReproTestRecord): void {
    appendFileSync(this.path('repro-tests.jsonl'), `${JSON.stringify(rec)}\n`);
  }

  attempt(rec: AttemptRecord): string {
    return this.write('attempt.json', `${JSON.stringify(rec, null, 2)}\n`);
  }
}
