// `fiks exp-eval` (paper/EXP-PLAN.md E-A outcomes): deterministic outcomes of exp-repair heads.
//
//   pnpm fiks exp-eval --run <runDir> [--run <runDir> ...] [--sandbox docker|host] [--json]
//   pnpm fiks exp-eval --root bench/results/exp/ablation [--force] [--sandbox ...]
//   pnpm fiks exp-eval --control oracle|seed --drift D1..D5|all [--out <dir>] [--sandbox ...]
//
// Each run's head is checked out fresh; held-out repro, live check and changed lines go to
// <runDir>/eval.json. Controls: the oracle patches (all outcomes must be true) and seed-v1 unpatched
// (held-out repro and live check must be false); exit 1 when a control does not come out that way.
// The sandbox defaults to the run's own (controls: host).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CliCommandModule } from '@fiks/interfaces';
import { isDrift } from '../exp/drifts.ts';
import {
  controlPasses,
  DEFAULT_CONTROLS_DIR,
  evaluateControl,
  evaluateRun,
  findRunDirs,
} from '../exp/evaluate.ts';
import { DRIFTS, type ExpDrift, type ExpEvalRecord, type SandboxKind } from '../exp/types.ts';

const USAGE =
  'exp-eval (--run <dir>... | --root <dir> [--force] | --control oracle|seed --drift D1..D5|all [--out <dir>]) [--sandbox docker|host] [--json]';

const line = (ev: ExpEvalRecord) =>
  `${ev.runId ?? `control ${ev.control}`} ${ev.drift}: heldOutRepro=${ev.heldOutRepro.ok} live.drift=${ev.live.drift.ok} live.v1=${ev.live.v1.ok} changedLines=${ev.changedLines.lines}${ev.error ? ` error=${ev.error.split('\n')[0]}` : ''}`;

const command: CliCommandModule = {
  name: 'exp-eval',
  describe: 'held-out repro, live check and changed lines for exp-repair heads (and the controls)',
  async run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        run: { type: 'string', multiple: true },
        root: { type: 'string' },
        force: { type: 'boolean', default: false },
        control: { type: 'string' },
        drift: { type: 'string' },
        out: { type: 'string' },
        sandbox: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
    if (values.help) {
      console.log(`  ${USAGE}`);
      return 0;
    }
    const sandbox = values.sandbox as SandboxKind | undefined;
    if (sandbox !== undefined && sandbox !== 'host' && sandbox !== 'docker') {
      console.error('--sandbox must be docker or host');
      return 2;
    }
    const results: ExpEvalRecord[] = [];
    if (values.control) {
      const c = values.control;
      const drifts: ExpDrift[] =
        values.drift === 'all' ? [...DRIFTS] : values.drift && isDrift(values.drift) ? [values.drift] : [];
      if ((c !== 'oracle' && c !== 'seed') || drifts.length === 0) {
        console.error(`usage: fiks ${USAGE}`);
        return 2;
      }
      let ok = true;
      for (const d of drifts) {
        const out = join(values.out ?? DEFAULT_CONTROLS_DIR, `${c}-${d}`);
        const ev = await evaluateControl(c, d, out, { sandbox: sandbox ?? 'host' });
        results.push(ev);
        const pass = controlPasses(ev);
        ok &&= pass;
        if (!values.json) console.log(`${pass ? 'PASS' : 'FAIL'} ${line(ev)}`);
      }
      if (values.json) console.log(JSON.stringify(results, null, 2));
      return ok ? 0 : 1;
    }
    const dirs = [...(values.run ?? [])];
    if (values.root) {
      for (const d of findRunDirs(values.root))
        if (values.force || !existsSync(join(d, 'eval.json'))) dirs.push(d);
    }
    if (!dirs.length) {
      if (values.root) {
        console.log('no runs to evaluate');
        return 0;
      }
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    for (const d of dirs) {
      const ev = await evaluateRun(d, { sandbox });
      if (!ev) {
        if (!values.json) console.log(`skip ${d}: no head (infra error or setup failure)`);
        continue;
      }
      results.push(ev);
      if (!values.json) console.log(line(ev));
    }
    if (values.json) console.log(JSON.stringify(results, null, 2));
    return 0;
  },
};

export default command;
