// Compiles: a stub Domain with every round-5 hook and the round-6 frozen clock, plus the other
// round-5/6 members the seed must export. Checked by domain-hooks.test.ts with tsc --noEmit.
import type { CallRecord, Domain, FrozenTrace, RealbugAdapter, RerecordLog } from '@fiks/interfaces';
import { stubAllowedEditPaths, stubBase, stubReproEmitter, stubSuite } from './stub.ts';

export const hooksOk: Domain = {
  ...stubBase('hooks-ok'),
  frozenClock: '2026-10-01T12:00:00.000Z',
  reproEmitter: stubReproEmitter,
  suite: stubSuite,
  allowedEditPaths: stubAllowedEditPaths,
};

export const rerecordLine: RerecordLog = {
  profile: { domain: 'shop', base: 'base-shop', ruleId: 'D3', ruleHash: 'sha256:0' },
  head: 'abc123',
  fromCommit: 'def456',
  check: 'P',
  files: [
    {
      path: 'test/repro/tr_1.json',
      mode: 'overlay',
      requestKeysBefore: ['POST /orders'],
      requestKeysAfter: ['POST /orders', 'GET /orders/o-1'],
      outcome: 'rerecorded',
    },
  ],
};

export const adapter: RealbugAdapter = {
  bugId: 'r10',
  repoDir: '.work/realbugs/r10',
  prefixSha: 'a',
  fixSha: 'b',
  serverCommand: 'node dist/index.js',
  baseUrlEnv: 'API_URL',
  testCommand: 'npx jest',
  testRunner: 'jest',
  suiteScope: ['src/**/*.test.ts'],
  allowedEditPaths: ['^src/.+\\.ts$'],
  humanFixTests: [],
  heldoutCommand: 'npx jest heldout',
  issuePath: 'realbugs/r10/issue.md',
  contractPath: 'realbugs/r10/contract.json',
  fixtures: [{ path: 'realbugs/r10/fixtures/a.json', label: 'recorded' }],
};

export const call: CallRecord = {
  callId: 'c-1',
  domain: 'shop',
  stratum: 'frame',
  catalog: 'extended-only',
  drift: null,
  mutant: null,
  tool: 'get_product',
  args: { id: 'p-1001' },
  upstream: [],
  output: { content: [] },
  events: [],
  entityClass: { price: 'in-stock' },
  originUnit: { price: 'p-1001' },
  capturedAt: '2026-10-01T12:00:00.000Z',
  controlOf: null,
};

export const frozen: FrozenTrace = {
  driftId: 'D2',
  callId: 'c-2',
  path: 'test/repro/tr_2.json',
  sha256: '0'.repeat(64),
  violated: [],
  target: ['shop.get_product/price-not-null'],
  controlCallId: 'c-1',
  attributableProperties: ['shop.get_product/price-not-null'],
  ivProperties: ['shop.get_product/price-not-null'],
  ivExcluded: [{ property: 'shop.get_product/fresh', controlVerdict: 'unverifiable' }],
  ivSidecarSha256: '1'.repeat(64),
};
