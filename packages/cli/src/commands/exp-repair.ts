// `fiks exp-repair` (paper/EXP-PLAN.md E-A, E-C): one exploratory repair run.
//
//   pnpm fiks exp-repair --drift D1..D5 --arm fiks|nohint|alert|alertplus --rep N [--sandbox docker|host]
//     [--inject <templateId> [--carrier <kind>]] [--out <dir>] [--agent-stub <script.json>]
//     [--model <id>] [--max-turns N] [--max-budget-usd X] [--json]
//
// Base shop-mcp seed-v1, the committed pilot trace, one agent attempt, the arm's gates, the head kept
// as refs/fiks-exp/<runId> in the local shop-mcp clone. Never pushes, never opens a PR. Writes
// <out>/record.json (default bench/results/exp/{ablation|injection}/<runId>/). Real model runs go
// through the Docker sandbox; host mode is for stub runs (or --unsafe-host).
import { parseArgs } from 'node:util';
import type { CliCommandModule } from '@fiks/interfaces';
import { isDrift } from '../exp/drifts.ts';
import { runExpRepair } from '../exp/repair-run.ts';
import { ARMS, type ExpArm, type SandboxKind } from '../exp/types.ts';

const USAGE =
  'exp-repair --drift D1..D5 --arm fiks|nohint|alert|alertplus --rep N [--sandbox docker|host] [--inject <templateId>] [--carrier <kind>] [--out <dir>] [--agent-stub <file>] [--model <id>] [--max-turns N] [--max-budget-usd X] [--json]';

const command: CliCommandModule = {
  name: 'exp-repair',
  describe: 'exploratory repair run for the input ablation (E-A) and the injection smoke test (E-C)',
  async run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        drift: { type: 'string' },
        arm: { type: 'string' },
        rep: { type: 'string' },
        sandbox: { type: 'string' },
        inject: { type: 'string' },
        carrier: { type: 'string' },
        out: { type: 'string' },
        'agent-stub': { type: 'string' },
        model: { type: 'string' },
        'max-turns': { type: 'string' },
        'max-budget-usd': { type: 'string' },
        'unsafe-host': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
    if (values.help) {
      console.log(`  ${USAGE}`);
      return 0;
    }
    const drift = values.drift ?? '';
    const arm = values.arm ?? '';
    const rep = Number(values.rep);
    if (!isDrift(drift) || !(ARMS as readonly string[]).includes(arm) || !Number.isInteger(rep) || rep < 0) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    const stub = values['agent-stub'];
    const sandbox = (values.sandbox ?? (stub ? 'host' : 'docker')) as SandboxKind;
    if (sandbox !== 'host' && sandbox !== 'docker') {
      console.error('--sandbox must be docker or host');
      return 2;
    }
    if (sandbox === 'host' && !stub && !values['unsafe-host']) {
      console.error(
        'a model run executes agent code: use --sandbox docker (or --unsafe-host to run it on this machine)',
      );
      return 2;
    }
    const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
    const { record: rec, outDir } = await runExpRepair({
      drift,
      arm: arm as ExpArm,
      rep,
      sandbox,
      inject: values.inject,
      carrier: values.carrier,
      out: values.out,
      agentStub: stub,
      model: values.model,
      maxTurns: num(values['max-turns']),
      maxBudgetUsd: num(values['max-budget-usd']),
    });
    if (values.json) console.log(JSON.stringify(rec, null, 2));
    else {
      console.log(
        [
          `exp-repair ${rec.runId}: ${rec.arm} ${rec.drift} rep ${rec.rep} (${rec.sandbox}, ${rec.runner})`,
          ...rec.gates.map((g) => `  ${g.ok ? 'ok  ' : 'FAIL'} ${g.name}: ${g.reason.split('\n')[0]}`),
          `  gates passed: ${rec.gatesPassed}; head: ${rec.head ? `${rec.head.sha.slice(0, 12)} (${rec.head.ref})` : 'none'}`,
          `  turns ${rec.turns}, cost $${rec.costUsd.toFixed(4)}, ${Math.round(rec.durationMs / 1000)} s` +
            (rec.infraError ? `; infraError: ${rec.infraError}` : ''),
          `  record: ${outDir}/record.json`,
          ...(rec.inject
            ? Object.entries(rec.inject.oracles).map(([g, r]) => `  oracle ${g}: ${r.hit ? 'HIT' : 'no hit'}`)
            : []),
        ].join('\n'),
      );
    }
    return 0;
  },
};

export default command;
