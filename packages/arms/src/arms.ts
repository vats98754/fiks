// The non-FIKS arms of PLAN 6.2 as `Arm` objects (packages/interfaces). FIKS and FIKS+CU are ORCH's
// (`pnpm fiks repair --arm fiks`); every arm here is run by `pnpm fiks arm --name <ARM>`.
//
//  L1          alert + trace + helper sentence -> agent -> suite + traces + typecheck/lint + IV (pre-PR)
//              -> local CI -> would_open_pr only when all are green; failures fed back, <= 4 sessions
//  L1-noIV     L1 without IV
//  L1p         L1 with the alert in prose only (no trace file, no helper sentence); IV still pre-PR
//  COMP        alert + trace + helper sentence, "reproduce first, then fix" -> would_open_pr on the
//              first non-empty diff -> local CI = repo CI + IV; red log fed back, <= 3 revisions / 90 min
//  COMP-norep  COMP without IV
//  COMP-plain  COMP-norep; CI runs only the server's own tests
//  ISSUE-TEXT  the upstream issue's title and body only -> agent -> repo CI after the PR, as COMP-norep
//  REPRO-AGENT alert + trace + helper sentence -> one new test under test/ -> F check with feedback
import type { Arm, ArmContext, ArmName, IvPlacement, PreGate } from '@fiks/interfaces';

export type RepairArmName = 'L1' | 'L1-noIV' | 'L1p' | 'COMP' | 'COMP-norep' | 'COMP-plain' | 'ISSUE-TEXT';
export type ArmsArmName = RepairArmName | 'REPRO-AGENT';

/** What the agent is given: alert + trace file + helper sentence; alert prose only; or the issue. */
export type Evidence = 'trace' | 'prose' | 'issue';

export interface ArmSpec extends Omit<Arm, 'prepare' | 'prompt'> {
  name: ArmsArmName;
  /** gated: fix sessions behind pre-PR gates; post-pr: PR on first diff, CI revisions; repro: REPRO-AGENT. */
  family: 'gated' | 'post-pr' | 'repro';
  evidence: Evidence;
  ivPlacement: IvPlacement;
}

const preL1: readonly PreGate[] = ['suite', 'traces', 'typecheck', 'lint', 'iv', 'local-ci'];
const preL1noIv: readonly PreGate[] = ['suite', 'traces', 'typecheck', 'lint', 'local-ci'];
const noCi = { when: 'none', iv: false, scope: 'repo', maxRevisions: 0 } as const;

export const ARM_SPECS: Readonly<Record<ArmsArmName, ArmSpec>> = Object.freeze({
  L1: {
    name: 'L1',
    family: 'gated',
    evidence: 'trace',
    ivPlacement: 'pre',
    preGates: preL1,
    ciPolicy: { when: 'pre-pr', iv: false, scope: 'repo', maxRevisions: 0 },
    prPolicy: 'all-gates-green',
  },
  'L1-noIV': {
    name: 'L1-noIV',
    family: 'gated',
    evidence: 'trace',
    ivPlacement: 'none',
    preGates: preL1noIv,
    ciPolicy: { when: 'pre-pr', iv: false, scope: 'repo', maxRevisions: 0 },
    prPolicy: 'all-gates-green',
  },
  L1p: {
    name: 'L1p',
    family: 'gated',
    evidence: 'prose',
    ivPlacement: 'pre',
    preGates: preL1,
    ciPolicy: { when: 'pre-pr', iv: false, scope: 'repo', maxRevisions: 0 },
    prPolicy: 'all-gates-green',
  },
  COMP: {
    name: 'COMP',
    family: 'post-pr',
    evidence: 'trace',
    ivPlacement: 'post',
    preGates: [],
    ciPolicy: { when: 'post-pr', iv: true, scope: 'repo', maxRevisions: 3 },
    prPolicy: 'first-nonempty-diff',
  },
  'COMP-norep': {
    name: 'COMP-norep',
    family: 'post-pr',
    evidence: 'trace',
    ivPlacement: 'none',
    preGates: [],
    ciPolicy: { when: 'post-pr', iv: false, scope: 'repo', maxRevisions: 3 },
    prPolicy: 'first-nonempty-diff',
  },
  'COMP-plain': {
    name: 'COMP-plain',
    family: 'post-pr',
    evidence: 'trace',
    ivPlacement: 'none',
    preGates: [],
    ciPolicy: { when: 'post-pr', iv: false, scope: 'server-tests', maxRevisions: 3 },
    prPolicy: 'first-nonempty-diff',
  },
  'ISSUE-TEXT': {
    name: 'ISSUE-TEXT',
    family: 'post-pr',
    evidence: 'issue',
    ivPlacement: 'none',
    preGates: [],
    ciPolicy: { when: 'post-pr', iv: false, scope: 'repo', maxRevisions: 3 },
    prPolicy: 'first-nonempty-diff',
  },
  'REPRO-AGENT': {
    name: 'REPRO-AGENT',
    family: 'repro',
    evidence: 'trace',
    ivPlacement: 'none',
    preGates: ['F'],
    ciPolicy: noCi,
    prPolicy: 'never',
  },
});

export const ARM_NAMES = Object.keys(ARM_SPECS) as ArmsArmName[];
export const REPAIR_ARMS = ARM_NAMES.filter((n) => ARM_SPECS[n].family !== 'repro') as RepairArmName[];

export function isArmsArm(name: string): name is ArmsArmName {
  return Object.hasOwn(ARM_SPECS, name);
}

export function armSpec(name: string): ArmSpec {
  if (!isArmsArm(name)) {
    throw new Error(
      `unknown arm ${JSON.stringify(name)}; fiks arm runs ${ARM_NAMES.join(', ')} (FIKS is 'fiks repair --arm fiks')`,
    );
  }
  return ARM_SPECS[name];
}

/** Arm as the interface type (prepare/prompt bound to the given implementations). */
export function asArm(
  spec: ArmSpec,
  impl: { prepare(ctx: ArmContext): Promise<void> | void; prompt(ctx: ArmContext): string },
): Arm & { name: ArmName } {
  return { ...spec, prepare: impl.prepare, prompt: impl.prompt };
}
