// Records the D1–D5 scenario calls (and v1-all) through the real harness, unfixed shop-mcp at
// seed-v1, vendor clock frozen, and writes their CallRecords (no receipts) to
// test/fixtures/scenario-records.json, plus seed-v1's declared tool outputSchemas to
// test/fixtures/tool-schemas.seed-v1.json. The vocabulary tests and replay-logged.ts replay them
// through the old and new evaluators.
//   pnpm tsx packages/contracts/test/capture-scenarios.ts
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runScenario } from '../../cli/src/commands/scenario.ts';
import { startHarness } from '../../cli/src/harness.ts';
import { shopAt, shopDir } from '../../cli/src/paths.ts';
import type { JsonSchema } from '../src/types.ts';
import type { LoggedCall } from './replay-lib.ts';

export const SCENARIO_IDS = ['v1-all', 'D1', 'D2', 'D3', 'D4', 'D5'] as const;
export const SCENARIO_CLOCK = new Date('2026-10-18T12:00:00.000Z');

export interface ScenarioRecord extends LoggedCall {
  scenario: string;
}

export interface ToolSchemas {
  ref: string;
  sha: string;
  tools: Record<string, JsonSchema | undefined>;
}

/** Runs every scenario once (isolated drift profile, shop-mcp seed-v1) and returns its CallRecords. */
export async function captureScenarios(): Promise<ScenarioRecord[]> {
  const out: ScenarioRecord[] = [];
  for (const id of SCENARIO_IDS) {
    await runScenario(id, {
      traceDir: false,
      clock: SCENARIO_CLOCK,
      onCall: (rec) => {
        const { receipt: _receipt, ...call } = rec;
        out.push({ scenario: id, ...(call as LoggedCall) });
        return undefined;
      },
    });
  }
  return out;
}

/** The outputSchemas shop-mcp at `ref` declares in tools/list (what the proxy evaluated against). */
export async function declaredSchemas(ref: string): Promise<ToolSchemas> {
  const sha = execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
    cwd: shopDir(),
    encoding: 'utf8',
  }).trim();
  const h = await startHarness({ vendor: 'v1', shopDir: shopAt(sha) });
  try {
    const { tools } = await h.client.listTools();
    return {
      ref,
      sha,
      tools: Object.fromEntries(tools.map((t) => [t.name, t.outputSchema as JsonSchema | undefined])),
    };
  } finally {
    await h.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;
  const records = await captureScenarios();
  writeFileSync(fixture('scenario-records.json'), `${JSON.stringify(records, null, 2)}\n`);
  const schemas = await declaredSchemas('seed-v1');
  writeFileSync(fixture('tool-schemas.seed-v1.json'), `${JSON.stringify(schemas, null, 2)}\n`);
  console.log(
    `[capture-scenarios] ${records.length} records, ${Object.keys(schemas.tools).length} tool schemas`,
  );
}
