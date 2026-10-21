// Build conventions: dependency fragments and CLI modules (PLAN.md 7.1, Appendix, P18).

/**
 * `deps-fragments/<stream>.json`: `@fiks/*` workspace dependencies a stream needs in a package it
 * does not own. Applied by `scripts/apply-dep-fragments.mjs`; any other key or value is rejected.
 */
export interface DepFragment {
  stream: string;
  add: Record<`packages/${string}`, Record<`@fiks/${string}`, 'workspace:*'>>;
  /** Root tsconfig `references` paths to add, e.g. `packages/foo`. */
  tsconfigReferences?: string[];
}

/** Default export of `packages/cli/src/commands/<name>.ts` (wins over `src/legacy/<name>.ts`). */
export interface CliCommandModule {
  name: string;
  describe: string;
  /** `argv` = the arguments after the command name; a number is the exit code. */
  // biome-ignore lint/suspicious/noConfusingVoidType: an `async run()` with no return value must fit.
  run(argv: string[]): Promise<number | void> | number | void;
}

/**
 * `packages/cli/src/bootstrap/NN-*.ts`: a side-effect module (e.g. `registerDomain(...)`), imported
 * in sorted file-name order before dispatch. It has no required exports.
 */
export type BootstrapModule = Record<string, unknown>;
