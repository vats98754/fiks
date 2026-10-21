// Pluggable result monitors (PLAN.md Appendix, P9). The default monitor is the contract evaluator.
import type { EvalInput, JsonSchema, ToolContract, Verdict, Violation } from '@fiks/contracts';

export interface MonitorOptions {
  /** Property ids to evaluate even though the contract marks them `disabled`. */
  reenable?: string[];
  /** One violation per violating element (offline H1 replay only; live receipts never use it). */
  perElement?: boolean;
}

export interface MonitorToolDef {
  name: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  description?: string;
}

/** EvalInput plus the call's tool, contract and declared tool definition. Offline, `now` = capturedAt. */
export interface MonitorInput extends EvalInput {
  tool: string;
  contract: ToolContract | null;
  toolDef: MonitorToolDef | null;
  opts?: MonitorOptions;
}

export interface MonitorResult {
  verdict: Verdict;
  checked: string[];
  violations: Violation[];
  /** Property ids skipped because the contract marks them `disabled`. */
  disabled: string[];
  costUsd?: number;
  tokens?: number;
}

/** A monitor is a function; `--monitor <module path>` loads one as the module's default export. */
export interface Monitor {
  (input: MonitorInput): MonitorResult | Promise<MonitorResult>;
  /** Recorded in every event (default: the module path or `contracts`). */
  readonly id?: string;
}

/** Round 6: optional flags on a contract property, set only by `scripts/contract-disable.mjs`. */
export interface ContractPropertyDisable {
  disabled?: true;
  disabledReason?: string;
}
