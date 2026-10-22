// `fiks validate-drift` (stream BLIND; PLAN 5.1, R0): automated validity of DriftPackages.
//
//   pnpm fiks validate-drift <driftpkg.json>... [--domain shop|tracker] [--repo-dir <clone>]
//       [--require-ref-b] [--json]
//
// Exit 0 = every package valid, 1 = an invalid package, 2 = usage. The domain defaults to each
// manifest's own `domain`; the server clone to the domain's (pinned) clone under .work/.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ValidityReport, validateDrift } from '@fiks/authoring';
import { getDomain } from '@fiks/domains';
import type { CliCommandModule } from '@fiks/interfaces';

const USAGE =
  'usage: fiks validate-drift <driftpkg.json>... [--domain d] [--repo-dir dir] [--require-ref-b] [--json]';

const command: CliCommandModule = {
  name: 'validate-drift',
  describe: 'validity of DriftPackages: spec unchanged, deterministic rule, base fails, refs pass',
  async run(argv) {
    let parsed: ReturnType<
      typeof parseArgs<{
        options: {
          domain: { type: 'string' };
          'repo-dir': { type: 'string' };
          'require-ref-b': { type: 'boolean' };
          json: { type: 'boolean' };
        };
        allowPositionals: true;
      }>
    >;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          domain: { type: 'string' },
          'repo-dir': { type: 'string' },
          'require-ref-b': { type: 'boolean' },
          json: { type: 'boolean' },
        },
      });
    } catch (e) {
      console.error(`${(e as Error).message}\n${USAGE}`);
      return 2;
    }
    const { values: v, positionals } = parsed;
    if (!positionals.length) {
      console.error(USAGE);
      return 2;
    }
    const reports: ValidityReport[] = [];
    for (const p of positionals) {
      const file = resolve(p);
      let domainId: string;
      try {
        domainId = v.domain ?? (JSON.parse(readFileSync(file, 'utf8')) as { domain: string }).domain;
      } catch (e) {
        console.error(`${p}: ${(e as Error).message}`);
        return 1;
      }
      const domain = getDomain(domainId);
      if (!v.json) console.log(`validate-drift ${p}`);
      const r = await validateDrift({
        pkgFile: file,
        domain,
        ...(v['repo-dir'] ? { repoDir: resolve(v['repo-dir']) } : {}),
        ...(v['require-ref-b'] ? { requireRefB: true } : {}),
        ...(v.json ? {} : { log: (l: string) => console.log(`  ${l}`) }),
      });
      reports.push(r);
      if (!v.json) console.log(`${r.valid ? 'VALID' : 'INVALID'} ${r.id}`);
    }
    if (v.json) console.log(JSON.stringify(reports, null, 2));
    return reports.every((r) => r.valid) ? 0 : 1;
  },
};

export default command;
