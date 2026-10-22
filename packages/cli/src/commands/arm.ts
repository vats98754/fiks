// `fiks arm` (stream ARMS, PLAN 6.2, P11, P21): one attempt of a comparator arm (L1, L1-noIV, L1p,
// COMP, COMP-norep, COMP-plain, ISSUE-TEXT, REPRO-AGENT). FIKS itself is `fiks repair --arm fiks`.
// @fiks/arms is imported when the command runs, so loading the CLI (every command) stays light.
import type { CliCommandModule } from '@fiks/interfaces';

const command: CliCommandModule & { help(): string } = {
  name: 'arm',
  describe:
    'one attempt of a comparator arm (L1, L1-noIV, L1p, COMP, COMP-norep, COMP-plain, ISSUE-TEXT, REPRO-AGENT)',
  help: () =>
    '  arm --name <ARM> --trace <frozen> (ISSUE-TEXT: --issue <file>) --base <local ref> --run-key <key> --ci local --no-pr [--domain <id>] [--trace-format raw|strict] [--agent-stub <script.json>] (fiks arm --help for all flags)',
  async run(argv) {
    const { armMain } = await import('@fiks/arms');
    return armMain(argv);
  },
};

export default command;
