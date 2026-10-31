// A head that crashes the server, evaluated in Docker (FIKS_EXP_DOCKER=1; needs Docker and a
// fiks-tools image, FIKS_TOOLS_IMAGE): the scenario exits non-zero inside the container, which is
// the head's failure (headErrors, outcomes false), not an infra exclusion.
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { evaluateRun } from '../../src/exp/evaluate.ts';
import { runExpRepair } from '../../src/exp/repair-run.ts';
import { validateEvalRecord } from '../../src/exp/types.ts';
import { CRASH_AT_IMPORT, scratch, shopClone } from './support.ts';

const DOCKER = process.env.FIKS_EXP_DOCKER === '1';
let shop: string;
let tmp: string;
beforeAll(() => {
  if (!DOCKER) return;
  shop = shopClone();
  tmp = scratch();
});

describe.runIf(DOCKER)('exp-eval --sandbox docker on a crashing head', () => {
  test('server throws at import: every stage is a head failure, nothing is excluded', {
    timeout: 30 * 60_000,
  }, async () => {
    const { record, outDir } = await runExpRepair({
      drift: 'D2',
      arm: 'alert',
      rep: 0,
      sandbox: 'docker',
      agentStub: CRASH_AT_IMPORT,
      out: join(tmp, 'crash'),
      shopRepo: shop,
      workDir: join(tmp, 'wt'),
    });
    expect(record.infraError).toBeNull();
    const ev = await evaluateRun(outDir, { shopRepo: shop, workDir: join(tmp, 'wt') });
    console.log(
      `[crash-docker] ${JSON.stringify(ev?.headErrors.map((e) => [e.stage, e.message.split('\n')[0]]))}`,
    );
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(ev?.sandbox).toBe('docker');
    expect(ev?.infraError).toBeNull();
    expect(ev?.liveCheck).toBe(false);
    expect(ev?.heldOutRepro.ok).toBe(false);
    expect(ev?.headErrors.map((e) => e.stage)).toEqual(['live.drift', 'live.v1', 'heldOutRepro']);
    expect(ev?.headErrors[0]?.message).toMatch(/^scenario D2 in the sandbox exited 1: .*Error/);
  });
});
