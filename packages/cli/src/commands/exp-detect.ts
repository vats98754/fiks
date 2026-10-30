// `fiks exp-detect clean|mutate` (paper/EXP-PLAN.md E-B, detection sweep). No model is called:
// FIKS_LLM_FORBID=1 is set before anything runs. Results: bench/results/exp/detect/<runId>/.
import { parseArgs } from 'node:util';
import type { CliCommandModule } from '@fiks/interfaces';
import { isResponseOperator, type ResponseOperator } from '@fiks/mutate';
import { runClean } from '../exp-detect/clean.ts';
import { forbidLlm } from '../exp-detect/io.ts';
import { runMutate } from '../exp-detect/mutate.ts';

const USAGE = `usage:
  fiks exp-detect clean  [--run-id <id>]
  fiks exp-detect mutate [--run <id> | --from-fixtures] [--seeds <n>] [--ops M1,M2,...]`;

export async function runExpDetect(argv: string[], log = (l: string) => console.log(l)): Promise<number> {
  forbidLlm();
  const [sub, ...rest] = argv;
  try {
    if (sub === 'clean') {
      const { values } = parseArgs({ args: rest, options: { 'run-id': { type: 'string' } } });
      await runClean({ runId: values['run-id'], log });
      return 0;
    }
    if (sub === 'mutate') {
      const { values } = parseArgs({
        args: rest,
        options: {
          run: { type: 'string' },
          'from-fixtures': { type: 'boolean', default: false },
          seeds: { type: 'string', default: '1' },
          ops: { type: 'string' },
        },
      });
      const ops = values.ops?.split(',').map((s) => s.trim());
      const bad = ops?.filter((o) => !isResponseOperator(o));
      if (bad?.length) {
        console.error(`unknown operator(s): ${bad.join(', ')}\n${USAGE}`);
        return 2;
      }
      if (values.run && values['from-fixtures']) {
        console.error(`--run and --from-fixtures are exclusive\n${USAGE}`);
        return 2;
      }
      const r = await runMutate({
        runId: values.run,
        fromFixtures: values['from-fixtures'],
        seeds: Number(values.seeds),
        ...(ops ? { ops: ops as ResponseOperator[] } : {}),
        log,
      });
      // An unfaithful replay (a control that does not reproduce its logged verdict, or a request
      // the recording cannot answer) makes the whole sweep suspect: written, but not a success.
      const unfaithful = r.rows.filter((x) => x.matchesLogged === false || x.unmatched > 0).length;
      if (unfaithful) {
        console.error(`exp-detect mutate: ${unfaithful} rows replayed unfaithfully; see ${r.dir}`);
        return 1;
      }
      return 0;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  console.error(USAGE);
  return 2;
}

const command: CliCommandModule = {
  name: 'exp-detect',
  describe: 'E-B detection sweep: clean v1 traffic and offline response mutations (no LLM)',
  run: (argv) => runExpDetect(argv),
};
export default command;
