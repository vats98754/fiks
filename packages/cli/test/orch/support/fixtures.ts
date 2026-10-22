// The committed ORCH fixtures and how each is generated (support/gen.ts). `regen.ts --write`
// rewrites them; fixtures.test.ts regenerates each in memory and asserts byte-equality.
import { join } from 'node:path';
import { ROOT } from '../../../src/paths.ts';
import { cleanCorpus, ORCH_FIXTURES, traceThroughRule } from './gen.ts';

export interface TraceFixture {
  file: string;
  domain: string;
  rule: string;
  ref: string;
}

export const TRACE_FIXTURES: TraceFixture[] = [
  {
    file: join(ORCH_FIXTURES, 'DEV-X1.trace.json'),
    domain: 'shop',
    rule: join(ROOT, 'packages/injector/fixtures/driftpkgs/DEV-X1.json'),
    ref: 'base-shop',
  },
  {
    file: join(ORCH_FIXTURES, 'TRK-DEV-1.trace.json'),
    domain: 'tracker',
    rule: join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json'),
    ref: 'dev-tracker-stub',
  },
  {
    file: join(ORCH_FIXTURES, 'BEN-DEV-1.trace.json'),
    domain: 'shop',
    rule: join(ORCH_FIXTURES, 'BEN-DEV-1.json'),
    ref: 'base-shop',
  },
];

export const CLEAN_V1 = { dir: join(ORCH_FIXTURES, 'clean-v1'), domain: 'shop', ref: 'base-shop' };

export const generateTrace = (f: TraceFixture) =>
  traceThroughRule({ domain: f.domain, rule: f.rule, ref: f.ref });
export const generateCorpus = () => cleanCorpus(CLEAN_V1.domain, CLEAN_V1.ref);
