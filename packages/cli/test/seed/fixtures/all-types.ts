// Names every type of the paper/PLAN.md Appendix, imported from @fiks/interfaces. interfaces.test.ts
// compiles this file with tsc --noEmit and checks the list against the Appendix.
import type {
  Arm,
  AttemptRecord,
  BootstrapModule,
  CallRecord,
  CandidateRecord,
  CiLocal,
  CliCommandModule,
  ConfigStep,
  ContractPropertyDisable,
  DepFragment,
  DetectorVerdictRow,
  Domain,
  DriftPackage,
  EnumRow,
  ExecBackend,
  FrameSpec,
  FrozenTrace,
  GradeRecord,
  InjectorRule,
  Monitor,
  RealbugAdapter,
  ReproTestRecord,
  RerecordLog,
  RunKey,
} from '@fiks/interfaces';

/** Fails to compile if K is not a key of T. */
type Has<T, K extends keyof T> = K;
/** Fails to compile if K is optional in T. */
type Required_<T, K extends keyof T> = Pick<T, K> extends Required<Pick<T, K>> ? K : never;
type Is<T extends true> = T;
type NotNever<T> = [T] extends [never] ? false : true;

export type AppendixTypes = [
  RunKey,
  AttemptRecord,
  ReproTestRecord,
  CandidateRecord,
  CallRecord,
  EnumRow,
  FrameSpec,
  FrozenTrace,
  DetectorVerdictRow,
  GradeRecord,
  DriftPackage,
  InjectorRule,
  Domain,
  Monitor,
  ContractPropertyDisable,
  ExecBackend,
  CiLocal,
  Arm,
  DepFragment,
  CliCommandModule,
  BootstrapModule,
  ConfigStep,
  RerecordLog,
  RealbugAdapter,
];

// Round-by-round members the WORKSTREAMS deliverable names explicitly.
export type Members = [
  Has<AttemptRecord, 'ivPlacement' | 'rerecordLog'>,
  Has<CallRecord, 'originUnit' | 'capturedAt' | 'controlOf'>,
  Has<FrameSpec, 'entities' | 'NE' | 'attribution' | 'families' | 'neRule'>,
  Has<
    FrozenTrace,
    | 'controlCallId'
    | 'attributableProperties'
    | 'ivProperties'
    | 'ivExcluded'
    | 'ivSidecarSha256'
    | 'violated'
    | 'target'
  >,
  Has<DetectorVerdictRow, 'at' | 'elementIndex'>,
  Has<DriftPackage, 'base'>,
  Has<Domain, 'originEntity' | 'frozenClock' | 'reproEmitter' | 'suite' | 'allowedEditPaths'>,
  Has<Domain['suite'], 'run' | 'scope' | 'oneFailingInScope'>,
  Has<RealbugAdapter, 'testRunner' | 'suiteScope' | 'allowedEditPaths'>,
  Has<ExecBackend, 'exec' | 'cleanup'>,
  Has<Arm, 'name' | 'prepare' | 'prompt' | 'preGates' | 'ciPolicy' | 'prPolicy'>,
];

export type RequiredMembers = [
  Is<NotNever<Required_<CallRecord, 'capturedAt' | 'controlOf' | 'originUnit'>>>,
  Is<NotNever<Required_<FrozenTrace, 'ivProperties' | 'violated' | 'target'>>>,
  Is<NotNever<Required_<Domain, 'frozenClock' | 'reproEmitter' | 'suite' | 'allowedEditPaths'>>>,
  Is<NotNever<Required_<RealbugAdapter, 'testRunner' | 'suiteScope' | 'allowedEditPaths'>>>,
];

// Monitor options carry the round-6 and round-7 flags.
export type MonitorOpts = Has<NonNullable<Parameters<Monitor>[0]['opts']>, 'reenable' | 'perElement'>;
