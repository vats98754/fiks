// grade(patch, drift) -> GradeRecord (PLAN 3.0 "Held-out-correct", five criteria):
//   1 hidden tests pass; 2 semantic differential vs ref A or ref B on 200 seeded inputs, under
//   vendor v1 and under vendor v1 + the drift's injector rule (ambiguous inputs counted); 3 the
//   renamed-id variant passes; 4 no new SAST finding confirmed by >= 2 of 3 tools on the diff;
//   5 held-out traffic matches truth() under both vendors.
// The host prepares heads and compares; everything that runs a head's code (re-record, hidden
// tests, the differential and the traffic replay) runs in that head's grading container (5.8, P1).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GradeCriteria, GradeRecord, RerecordLog } from '@fiks/interfaces';
import { diffSha, parseUnifiedDiff } from './diff.ts';
import { exportBase, type Head, prepareHead, writeInto } from './head.ts';
import { type DiffInput, drawInputs, inputsHash } from './inputs.ts';
import {
  type CallObservation,
  type HiddenRun,
  OBSERVE_SENTINEL,
  type ObserveRequest,
  type ObserveResult,
  parseObserveOutput,
  SETTINGS,
  type Setting,
  type TrafficTask,
} from './observe.ts';
import { type LoadedPackage, profileOf } from './pkg.ts';
import { rerecordIn, restoreOverlay } from './rerecord.ts';
import { fiksIn, ruleMount, type SandboxFactory, WORKDIR } from './sandbox.ts';
import { defaultSastTools, type SastResult, type SastTool, sastOnDiff } from './sast/index.ts';
import { matchesTruth, outputsEquivalent, type SemanticOptions } from './semantic.ts';

export { OBSERVE_SENTINEL };

export interface PatchInput {
  id: string;
  /** Unified diff against the drift's base ('' = the base itself). */
  diff: string;
}

export interface GradeEnv {
  sandbox: SandboxFactory;
  /** Host clone of the domain's repo holding the drift's base ref (e.g. .work/shop-mcp). */
  repoDir: string;
  /** The domain's frozen clock (Domain.frozenClock). */
  clock: string;
  /** Held-out traffic for criterion 5 (PLAN 5.9). */
  traffic: TrafficTask[];
  sast?: SastTool[];
  seed?: number;
  runs?: number;
  semantic?: SemanticOptions;
  log?: (line: string) => void;
}

/** Reason codes, in criterion order (GradeRecord.reasons). */
export const REASONS = {
  apply: 'patch-apply',
  infra: 'observation-error',
  hidden: 'hidden',
  differential: 'differential',
  renamed: 'renamed-id',
  sast: 'sast',
  truth: 'truth-replay',
} as const;

export interface HeadObservation {
  headCommit: string;
  tree: string;
  applied: boolean;
  applyError?: string;
  observation?: ObserveResult;
  rerecord?: { exit: number; ok: boolean; log: RerecordLog | null };
  error?: string;
}

export interface GradeDetail {
  patchId: string;
  drift: string;
  diffSha: string;
  head: Omit<HeadObservation, 'observation'>;
  hidden: HiddenRun[];
  differentialMismatches: { input: number; setting: Setting }[];
  ambiguous: number[];
  truthMismatches: { task: string; setting: Setting; call: number }[];
  sast: SastResult | null;
}

export interface GradeOutcome {
  record: GradeRecord;
  detail: GradeDetail;
}

/** The criteria and reasons of one patch, from its observation, the refs' and SAST (pure). */
export function judge(
  patchId: string,
  drift: string,
  head: HeadObservation,
  refA: ObserveResult,
  refB: ObserveResult,
  traffic: readonly TrafficTask[],
  sast: SastResult | null,
  sem: SemanticOptions = {},
): GradeOutcome {
  const base = { patchId, drift, diffSha: '', head: { ...head, observation: undefined } };
  const obs = head.observation;
  const ambiguous: number[] = [];
  const n = refA.differential.v1.length;
  for (let i = 0; i < n; i++) {
    if (SETTINGS.some((s) => !sequenceEqual(refA.differential[s][i], refB.differential[s][i], sem)))
      ambiguous.push(i);
  }
  if (!head.applied || !obs) {
    const criteria: GradeCriteria = {
      hidden: false,
      differential: false,
      ambiguousInputs: ambiguous.length,
      renamedId: false,
      sast: sast?.pass ?? false,
      truthReplay: false,
    };
    return {
      record: {
        patchId,
        drift,
        criteria,
        correct: false,
        reasons: [head.applied ? REASONS.infra : REASONS.apply],
      },
      detail: { ...base, hidden: [], differentialMismatches: [], ambiguous, truthMismatches: [], sast },
    };
  }
  const plain = obs.hidden.filter((h) => !h.renamed);
  const renamed = obs.hidden.filter((h) => h.renamed);
  const differentialMismatches: GradeDetail['differentialMismatches'] = [];
  for (const s of SETTINGS) {
    for (let i = 0; i < n; i++) {
      const p = obs.differential[s][i];
      if (!sequenceEqual(p, refA.differential[s][i], sem) && !sequenceEqual(p, refB.differential[s][i], sem))
        differentialMismatches.push({ input: i, setting: s });
    }
  }
  const truthMismatches: GradeDetail['truthMismatches'] = [];
  for (const s of SETTINGS) {
    obs.traffic[s].forEach((calls, t) => {
      calls.forEach((c, k) => {
        if (!matchesTruth(c.output, { inputValid: c.inputValid, expected: c.expected }, sem))
          truthMismatches.push({ task: traffic[t]?.id ?? String(t), setting: s, call: k });
      });
    });
  }
  const criteria: GradeCriteria = {
    hidden: plain.length > 0 && plain.every((h) => h.pass),
    differential: differentialMismatches.length === 0 && obs.differential.v1.length === n,
    ambiguousInputs: ambiguous.length,
    renamedId: renamed.length > 0 && renamed.every((h) => h.pass),
    sast: sast?.pass ?? false,
    truthReplay: truthMismatches.length === 0,
  };
  const reasons: string[] = [];
  if (!criteria.hidden) reasons.push(REASONS.hidden);
  if (!criteria.differential) reasons.push(REASONS.differential);
  if (!criteria.renamedId) reasons.push(REASONS.renamed);
  if (!criteria.sast) reasons.push(REASONS.sast);
  if (!criteria.truthReplay) reasons.push(REASONS.truth);
  return {
    record: { patchId, drift, criteria, correct: reasons.length === 0, reasons },
    detail: { ...base, hidden: obs.hidden, differentialMismatches, ambiguous, truthMismatches, sast },
  };
}

function sequenceEqual(
  a: readonly CallObservation[] | undefined,
  b: readonly CallObservation[] | undefined,
  sem: SemanticOptions,
): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, k) => {
    const y = b[k] as CallObservation;
    // error == empty when truth() marks the input invalid (on either head's vendor state).
    const inputValid = x.inputValid && y.inputValid;
    return outputsEquivalent(x.output, y.output, { ...sem, inputValid });
  });
}

/** Grades patches of one drift; ref A/B observations and the inputs are computed once. */
export class Grader {
  private inputs?: Promise<DiffInput[]>;
  private refs?: Promise<{ A: HeadObservation; B: HeadObservation }>;

  constructor(
    readonly pkg: LoadedPackage,
    readonly env: GradeEnv,
  ) {}

  private say(line: string) {
    this.env.log?.(`[grade ${this.pkg.pkg.id}] ${line}`);
  }

  differentialInputs(): Promise<DiffInput[]> {
    this.inputs ??= drawInputs(this.pkg.generators, { seed: this.env.seed, n: this.env.runs });
    return this.inputs;
  }

  refObservations(): Promise<{ A: HeadObservation; B: HeadObservation }> {
    this.refs ??= (async () => ({
      A: await this.observeDiff(readFileSync(this.pkg.refA, 'utf8'), 'refA'),
      B: await this.observeDiff(readFileSync(this.pkg.refB, 'utf8'), 'refB'),
    }))();
    return this.refs;
  }

  /** Prepares the head and observes it in its own grading container. */
  async observeDiff(diff: string, label: string): Promise<HeadObservation> {
    const head = prepareHead(this.env.repoDir, this.pkg.pkg.base, diff);
    try {
      return await this.observeHead(head, label);
    } finally {
      head.remove();
    }
  }

  async observeHead(head: Head, label: string): Promise<HeadObservation> {
    const out: HeadObservation = {
      headCommit: head.headCommit,
      tree: head.tree,
      applied: head.applied,
      ...(head.error ? { applyError: head.error } : {}),
    };
    if (!head.applied) return out;
    const rule = ruleMount(this.pkg.rule);
    const t0 = Date.now();
    const sb = await this.env.sandbox(head.dir, [rule.mount]);
    try {
      // One re-record per head (P23), before anything replays a recording; the hidden tests here
      // are self-contained (live upstream), so no recording is named beyond the suite's own.
      const rr = await rerecordIn(sb, {
        profile: profileOf(this.pkg),
        rulePath: rule.rulePath,
        fromCommit: head.baseCommit,
        check: 'accept',
        recordings: [],
      });
      out.rerecord = { exit: rr.exit, ok: rr.ok, log: rr.log };
      // Hidden tests import ../../src, so both variants sit two levels below the repo root.
      const placed = [
        ...this.pkg.hidden.map((h) => ({ path: `test/hidden/${h.name}`, src: h.path, renamed: false })),
        ...this.pkg.renamed.map((h) => ({
          path: `test/hidden-renamed/${h.name}`,
          src: h.path,
          renamed: true,
        })),
      ];
      writeInto(
        head.dir,
        placed.map((h) => ({ path: h.path, bytes: readFileSync(h.src) })),
      );
      const req: ObserveRequest = {
        domain: this.pkg.pkg.domain,
        worktree: WORKDIR,
        rule: rule.containerRule,
        clock: this.env.clock,
        hidden: placed.map((h) => ({ path: h.path, renamed: h.renamed })),
        rename: this.pkg.rename,
        inputs: await this.differentialInputs(),
        traffic: this.env.traffic,
      };
      const r = await fiksIn(sb, ['grade', '--observe', '--require-sandbox'], {
        input: JSON.stringify(req),
        timeoutMs: 45 * 60_000,
      });
      try {
        out.observation = parseObserveOutput(r.stdout);
      } catch (e) {
        out.error = `${(e as Error).message}\nexit ${r.code}: ${r.stderr.slice(-1500)}`;
      }
      await restoreOverlay(sb, rr.manifest);
    } finally {
      await sb.cleanup();
      rmSync(rule.mount.source, { recursive: true, force: true });
    }
    this.say(
      `${label}: observed ${out.headCommit.slice(0, 10)} in ${Math.round((Date.now() - t0) / 1000)} s`,
    );
    return out;
  }

  async sast(head: Head, diff: string): Promise<SastResult | null> {
    if (!head.applied || !diff.trim()) return { newFindings: [], confirmed: [], pass: true, files: [] };
    const baseOut = mkdtempSync(join(tmpdir(), 'fiks-heldout-sast-base-'));
    try {
      const paths = parseUnifiedDiff(diff)
        .map((f) => f.oldPath)
        .filter((p): p is string => !!p);
      exportBase(head.dir, head.baseCommit, paths, baseOut);
      return await sastOnDiff({
        baseDir: baseOut,
        headDir: head.dir,
        diff,
        tools: this.env.sast ?? defaultSastTools(),
      });
    } finally {
      rmSync(baseOut, { recursive: true, force: true });
    }
  }

  async grade(patch: PatchInput): Promise<GradeOutcome> {
    const refs = await this.refObservations();
    if (!refs.A.observation || !refs.B.observation) {
      throw new Error(
        `${this.pkg.pkg.id}: reference observation failed (A: ${refs.A.error ?? refs.A.applyError ?? 'ok'}; B: ${refs.B.error ?? refs.B.applyError ?? 'ok'})`,
      );
    }
    const head = prepareHead(this.env.repoDir, this.pkg.pkg.base, patch.diff);
    try {
      const sast = await this.sast(head, patch.diff);
      const obs = await this.observeHead(head, patch.id);
      const out = judge(
        patch.id,
        this.pkg.pkg.id,
        obs,
        refs.A.observation,
        refs.B.observation,
        this.env.traffic,
        sast,
        this.env.semantic,
      );
      out.detail.diffSha = diffSha(patch.diff);
      return out;
    } finally {
      head.remove();
    }
  }
}

/** One-shot form: grade(patch, drift package, environment). */
export function grade(patch: PatchInput, pkg: LoadedPackage, env: GradeEnv): Promise<GradeOutcome> {
  return new Grader(pkg, env).grade(patch);
}

export { inputsHash };
