// The Domain registry entry (PLAN.md Appendix, P8). One per target: `shop` (CORE), `tracker`
// (DOM2), `rb-<id>` (RBA). Members use method syntax so a domain can narrow parameter types
// (e.g. its own VendorState) and still satisfy the interface.
import type { Recording, Violation } from '@fiks/contracts';
import type { InjectorRule } from './drift.ts';
import type { Catalog, EnumRow, PropertyPath } from './records.ts';

/** A tool call as the domain's helpers see it. */
export interface DomainCall {
  tool: string;
  args: Record<string, unknown>;
  /** The tool's structured output, when known. */
  output?: unknown;
}

export interface DomainVendorOptions {
  /** Vendor version, e.g. `v1` | `v2`. */
  version: string;
  /** Comma list of drift ids (version-dependent default). */
  drifts?: string;
  /** Frozen clock; defaults to the wall clock. */
  now?: () => Date;
}

/** A running (or startable) mock vendor. */
export interface DomainVendor {
  /** Ground-truth state, read by `truth()` and task graders. */
  state: unknown;
  reset(): void;
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

/** What the tool should have returned for one call, from vendor ground truth. */
export interface TruthResult {
  /** False when the input is invalid (then error is equivalent to empty). */
  inputValid: boolean;
  expected: unknown;
  /** Property paths where the actual output disagrees with `expected` (when an output was given). */
  mismatches?: PropertyPath[];
}

/** A link in the harness's upstream chain (tap, injector, ...): fronts `target`, returns its own URL. */
export interface UpstreamMiddleware {
  name: string;
  start(target: string): Promise<{ url: string; close(): Promise<void> }>;
}

export interface ServerCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface DomainRepo {
  /** `owner/name` on GitHub, e.g. `vats98754/shop-mcp`. */
  slug: string;
  /** Local clone (under `.work/`, env overrides allowed). */
  dir(): string;
}

export interface DomainScenarioCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface DomainScenario {
  id: string;
  vendor: string;
  drift?: string;
  calls: DomainScenarioCall[];
  /** Contract properties this drift breaks: a trace's `target`. */
  target: string[];
}

export interface DomainFixtureCall {
  slug: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface TaskGrade {
  pass: boolean;
  outcome: string;
  reason: string;
}

export interface DomainTask {
  id: string;
  drift?: string;
  prompt: string;
  grade(answer: string, state: unknown): TaskGrade;
}

/** Domain-specific lines for the repair prompt (fixture layout, test commands, ...). */
export interface DomainPromptHints {
  repair: string[];
  [k: string]: unknown;
}

export interface EnumerateOptions {
  catalog: Catalog;
  seed: string | number;
  stratum?: string;
}

export interface PaginatedEndpoint {
  method: string;
  pathPattern: string;
  pageParam?: string;
}

// --- Domain hooks (round 5) ---------------------------------------------------------------

/** A captured violation as stored for a repro: the recording plus what it violated. */
export interface ReproTrace extends Recording {
  runId: string;
  contractId: string;
  violated: Violation[];
  server: { name: string; transport: 'stdio' | 'http'; gitSha?: string };
}

export interface ReproSpec {
  traceId: string;
  /** The target properties: the test must fail naming each of them. */
  propertyIds: string[];
  /** Relative to the target repo. */
  testPath: string;
  tracePath: string;
}

export interface EmittedFile {
  /** Relative to the target repo. */
  path: string;
  bytes: string | Uint8Array;
}

/** Writes nothing: returns the repro files in the target repo's layout. */
export type ReproEmitter = (trace: ReproTrace, spec: ReproSpec) => { files: EmittedFile[]; testPath: string };

export interface FailedTest {
  file: string;
  test: string;
  message: string;
}

export interface FileResult {
  file: string;
  statuses: string[];
}

/** Same shape as `@fiks/repro` SuiteRun. */
export interface SuiteRun {
  exitCode: number;
  failed: FailedTest[];
  files: FileResult[];
  suiteErrors: string[];
  logPath: string;
  command: string;
}

export interface DomainSuite {
  /** Runs the target repo's test suite, limited to `scope` globs (default: `this.scope`). */
  run(repoDir: string, scope?: readonly string[]): SuiteRun;
  /** Globs relative to the repo; `['**']` = the whole suite. */
  scope: readonly string[];
  /** The F condition: exactly one failing test, and it lies inside `scope`. */
  oneFailingInScope(run: SuiteRun, scope?: readonly string[]): boolean;
}

/** Regex sources; a repair may only edit repo-relative paths matching one of them. */
export type AllowedEditPaths = readonly string[];

export interface Domain {
  id: string;
  createVendor(catalog: Catalog, opts: DomainVendorOptions): DomainVendor;
  /** Constant ISO instant, committed before F2; record runs use it for vendor and proxy `now`. */
  frozenClock: string;
  truth(call: DomainCall, state: unknown): TruthResult;
  /** Entity class per property path of one call. */
  entityClass(call: DomainCall): Record<PropertyPath, string>;
  /** Origin unit (entity id, offending item, S-grid query id) per property path of one call. */
  originEntity(call: DomainCall): Record<PropertyPath, string>;
  injectorHook(rule: InjectorRule): UpstreamMiddleware;
  /** Response header that carries the vendor version. */
  versionHeader: string;
  contractsPath: string;
  /** Env var the server reads for the upstream base URL. */
  baseUrlEnv: string;
  serverCommand(repoDir: string): ServerCommand;
  repo: DomainRepo;
  seedTag: string;
  scenarios: Record<string, DomainScenario>;
  fixtureCalls: DomainFixtureCall[];
  tasks: DomainTask[];
  promptHints: DomainPromptHints;
  enumerate(opts: EnumerateOptions): EnumRow[];
  paginatedEndpoints: PaginatedEndpoint[];
  reproEmitter: ReproEmitter;
  suite: DomainSuite;
  allowedEditPaths: AllowedEditPaths;
}
