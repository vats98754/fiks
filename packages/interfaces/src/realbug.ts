// Real-bug adapters (PLAN.md Appendix, 5.10, P22): one `realbugs/<id>/adapter.json` per bug.

export type TestRunner = 'vitest' | 'jest' | 'node-test' | 'mocha' | (string & {});

export interface RealbugFixture {
  path: string;
  label: 'recorded' | 'synthesized';
}

export interface RealbugAdapter {
  bugId: string;
  /** `.work/realbugs/<id>`. */
  repoDir: string;
  prefixSha: string;
  fixSha: string;
  serverCommand: string;
  baseUrlEnv: string;
  testCommand: string;
  testRunner: TestRunner;
  /** Globs of the suite scope (Domain.suite.scope). */
  suiteScope: string[];
  /** Regex sources (Domain.allowedEditPaths). */
  allowedEditPaths: string[];
  humanFixTests: string[];
  heldoutCommand: string;
  issuePath: string;
  contractPath: string;
  fixtures: RealbugFixture[];
}
