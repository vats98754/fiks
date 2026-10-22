// B-LLMC runner (PLAN 6.1): LLM-authored contracts evaluated by the fiks evaluator. The contracts
// are written by BLIND (`pnpm fiks author --kind contract --protocol llm --seed n`: Opus, tool
// descriptions + 20 S-dev samples, 3 seeds per domain) into
// packages/contracts/contracts/llm-authored/<domain>-seed<n>.contracts.json. This module only loads
// a contract file and evaluates calls against it, exactly as the hand-written contracts are.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ContractFile, evaluate, findContract } from '@fiks/contracts';
import type { MonitorInput, MonitorResult } from '@fiks/interfaces';
import type { SyncBaselineMonitor } from './types.ts';
import { sha256Hex } from './util.ts';

export const LLMC_SEEDS = [1, 2, 3] as const;
export const LLM_AUTHORED_DIR = new URL('../../contracts/contracts/llm-authored/', import.meta.url).pathname;

/** Shape check of a contract file (the full vocabulary check is VOCAB's loader, run by BLIND). */
export function parseContractFile(text: string, where = 'contract file'): ContractFile {
  const doc = JSON.parse(text) as Partial<ContractFile>;
  if (doc === null || typeof doc !== 'object') throw new Error(`${where}: not a JSON object`);
  if (doc.version !== 1) throw new Error(`${where}: version must be 1`);
  if (typeof doc.server !== 'string') throw new Error(`${where}: server must be a string`);
  if (!Array.isArray(doc.contracts)) throw new Error(`${where}: contracts must be an array`);
  for (const c of doc.contracts) {
    if (typeof c?.id !== 'string' || typeof c?.tool !== 'string' || !Array.isArray(c?.invariants))
      throw new Error(`${where}: every contract needs id, tool and invariants[]`);
  }
  return doc as ContractFile;
}

export function llmcContractPath(domain: string, seed: number, dir = LLM_AUTHORED_DIR): string {
  return join(dir, `${domain}-seed${seed}.contracts.json`);
}

export interface LlmcMonitorOptions {
  /** Detector label, e.g. `shop-seed1`. */
  label: string;
  contracts: ContractFile;
  /** sha256 of the contract file's bytes, recorded with every run. */
  sha256?: string;
}

/** B-LLMC monitor: the fiks evaluator on the LLM-authored contract of the call's tool. */
export function createLlmcMonitor(opts: LlmcMonitorOptions): SyncBaselineMonitor & { sha256: string | null } {
  const monitor = (input: MonitorInput): MonitorResult => {
    const contract = findContract(opts.contracts, input.tool);
    const r = evaluate(contract, {
      args: input.args,
      result: input.result,
      now: input.now,
      declaredOutputSchema: input.declaredOutputSchema,
      probe: input.probe,
      upstream: input.upstream,
    });
    return { verdict: r.verdict, checked: r.checked, violations: r.violations, disabled: [] };
  };
  return Object.assign(monitor, { id: `B-LLMC:${opts.label}`, sha256: opts.sha256 ?? null });
}

/** Monitors for every LLM-authored seed of a domain that exists (BLIND writes them at A0). */
export function loadLlmcMonitors(
  domain: string,
  dir = LLM_AUTHORED_DIR,
): ReturnType<typeof createLlmcMonitor>[] {
  const out: ReturnType<typeof createLlmcMonitor>[] = [];
  for (const seed of LLMC_SEEDS) {
    const path = llmcContractPath(domain, seed, dir);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    out.push(
      createLlmcMonitor({
        label: `${domain}-seed${seed}`,
        contracts: parseContractFile(text, path),
        sha256: sha256Hex(text),
      }),
    );
  }
  return out;
}
