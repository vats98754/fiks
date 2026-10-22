// Pluggable result monitors (paper/PLAN.md P9). The default monitor is the contract evaluator;
// `--monitor <module path>` loads any other monitor as the module's default export.
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type EvalInput, type EvalResult, evaluate, type ToolContract } from '@fiks/contracts';
import type { Monitor, MonitorInput, MonitorOptions, MonitorResult } from '@fiks/interfaces';

/** `--monitor none`: record calls (output, upstream exchanges) with no evaluation at all. */
export const NO_MONITOR = 'none';
export const CONTRACTS_MONITOR_ID = 'contracts';

/**
 * The contract evaluator, with the options argument it takes (VOCAB `EvalOptions`: `reenable`,
 * `perElement`). `disabled` lists properties the contract marks disabled (VOCAB, round 6).
 */
export type EvaluateFn = (
  contract: ToolContract | undefined,
  input: EvalInput,
  opts?: MonitorOptions,
) => EvalResult & { disabled?: string[] };

/**
 * The default monitor: `evaluate()` from @fiks/contracts. `opts` (reenable, perElement) reach the
 * evaluator unchanged; the live proxy never sets them. `evaluator` is injectable for tests.
 */
export function contractsMonitor(evaluator: EvaluateFn = evaluate): Monitor {
  const monitor = (input: MonitorInput): MonitorResult => {
    const { tool: _tool, contract, toolDef, opts, ...evalInput } = input;
    const e = evaluator(
      contract ?? undefined,
      { ...evalInput, declaredOutputSchema: evalInput.declaredOutputSchema ?? toolDef?.outputSchema },
      opts,
    );
    return { verdict: e.verdict, checked: e.checked, violations: e.violations, disabled: e.disabled ?? [] };
  };
  return Object.assign(monitor, { id: CONTRACTS_MONITOR_ID });
}

/** A monitor result in the evaluator's shape (what receipts and hints read). */
export function asEvalResult(
  r: MonitorResult,
  contract: ToolContract | undefined | null,
): EvalResult & { disabled: string[] } {
  return {
    verdict: r.verdict,
    contractId: contract?.id ?? null,
    checked: r.checked,
    violations: r.violations,
    disabled: r.disabled ?? [],
  };
}

export const monitorId = (m: Monitor, fallback: string): string => m.id ?? fallback;

/**
 * `contracts` | `none` | a module path (resolved against `cwd`) whose default export is a
 * Monitor. Returns `'none'` for `none`.
 */
export async function loadMonitor(spec: string, cwd = process.cwd()): Promise<Monitor | typeof NO_MONITOR> {
  if (spec === NO_MONITOR) return NO_MONITOR;
  if (spec === CONTRACTS_MONITOR_ID) return contractsMonitor();
  const file = isAbsolute(spec) ? spec : resolve(cwd, spec);
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  const m = mod.default;
  if (typeof m !== 'function')
    throw new Error(`--monitor ${spec}: the module has no default-export function`);
  const id = (m as Monitor).id ?? spec;
  return Object.assign((input: MonitorInput) => (m as Monitor)(input), { id });
}
