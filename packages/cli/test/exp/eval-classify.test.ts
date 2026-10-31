// exp-eval's split between a head's own failure (counted: the stage's outcome is false) and an
// infra failure (excluded, labelled infra, retried). A fake sandbox wraps the real host sandbox and
// fails in chosen ways; the checkouts, suites and the other stages are real.
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { controlPasses, evaluateControl } from '../../src/exp/evaluate.ts';
import { type ExpSandbox, HostExpSandbox, SandboxInfraError } from '../../src/exp/sandbox.ts';
import { validateEvalRecord } from '../../src/exp/types.ts';
import { scratch, shopClone } from './support.ts';

const T = 300_000;
let shop: string;
let tmp: string;
beforeAll(() => {
  shop = shopClone();
  tmp = scratch();
});

interface Faults {
  scenario?: (id: string) => Error | undefined;
  /** healthy() answers, in order (then true). */
  health?: boolean[];
}

/** A host sandbox with injected faults; `made` counts the sandboxes the eval asked for. */
function factory(faultsFor: (n: number) => Faults | 'fail-start') {
  const state = { made: 0 };
  const make = async (_kind: unknown, worktree: string): Promise<ExpSandbox> => {
    const f = faultsFor(state.made++);
    if (f === 'fail-start') throw new Error('Cannot connect to the Docker daemon');
    const real = new HostExpSandbox(worktree);
    const health = [...(f.health ?? [])];
    return Object.assign(Object.create(real) as ExpSandbox, {
      scenario: async (id: string) => {
        const e = f.scenario?.(id);
        if (e) throw e;
        return real.scenario(id);
      },
      healthy: async () => health.shift() ?? true,
    });
  };
  return { state, make };
}

const evalWith = (control: 'oracle' | 'seed', name: string, f: ReturnType<typeof factory>) =>
  evaluateControl(control, 'D2', join(tmp, name), {
    shopRepo: shop,
    workDir: join(tmp, 'wt'),
    sandboxFactory: (k, w) => f.make(k, w),
  });

describe('exp-eval: head failure vs infra', () => {
  test('a server crash in the scenarios is the head failing: counted, not excluded', {
    timeout: T,
  }, async () => {
    const f = factory(() => ({
      scenario: () => Object.assign(new Error('MCP error -32000: Connection closed'), { code: -32000 }),
    }));
    const ev = await evalWith('oracle', 'crash', f);
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(ev.infraError).toBeNull();
    expect(ev.infraRetries).toBe(0);
    expect(ev.headErrors.map((e) => e.stage)).toEqual(['live.drift', 'live.v1']);
    expect(ev.headErrors[0]?.message).toContain('Connection closed');
    expect(ev.liveCheck).toBe(false);
    // The other stage still ran on the head: the oracle fix passes the held-out repro.
    expect(ev.heldOutRepro.ok, ev.heldOutRepro.reason).toBe(true);
    expect(controlPasses(ev)).toBe(false);
  });

  test('a container that stops during a stage: head failure when a fresh one runs', {
    timeout: T,
  }, async () => {
    // Sandbox 0 reports unhealthy after live.drift; sandbox 1 (the replacement) is healthy.
    const f = factory((n) => (n === 0 ? { health: [false] } : {}));
    const ev = await evalWith('oracle', 'stopped', f);
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(f.state.made).toBe(2);
    expect(ev.infraError).toBeNull();
    expect(ev.headErrors).toEqual([
      { stage: 'live.drift', message: 'the sandbox container stopped while the head ran' },
    ]);
    expect(ev.live.drift.ok).toBe(false);
    expect(ev.live.v1.ok).toBe(true);
    expect(ev.heldOutRepro.ok).toBe(true);
  });

  test('docker failing to run the scenario is infra: excluded, labelled, retried', {
    timeout: T,
  }, async () => {
    const f = factory(() => ({
      scenario: () => new SandboxInfraError('docker could not run scenario D2 (exit 125)'),
    }));
    const ev = await evalWith('oracle', 'infra-exec', f);
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(ev.infraError).toContain('exit 125');
    expect(ev.infraRetries).toBe(3);
    expect(f.state.made).toBe(4);
    expect(ev.liveCheck).toBe(false);
    expect(ev.heldOutRepro.ok).toBe(false);
    expect(ev.headErrors).toEqual([]);
  });

  test('a sandbox that never starts is infra', { timeout: T }, async () => {
    const f = factory(() => 'fail-start');
    const ev = await evalWith('seed', 'infra-start', f);
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(ev.infraError).toMatch(/^sandbox did not start: Cannot connect to the Docker daemon/);
    expect(ev.infraRetries).toBe(3);
    expect(controlPasses(ev)).toBe(false);
  });

  test('a stopped container whose replacement does not run either is infra', { timeout: T }, async () => {
    const f = factory(() => ({ health: [false, false, false, false] }));
    const ev = await evaluateControl('oracle', 'D2', join(tmp, 'infra-dead'), {
      shopRepo: shop,
      workDir: join(tmp, 'wt'),
      sandboxFactory: (k, w) => f.make(k, w),
      maxInfraRetries: 0,
    });
    expect(validateEvalRecord(ev)).toEqual([]);
    expect(ev.infraError).toBe('a fresh sandbox container does not run commands');
    expect(ev.infraRetries).toBe(0);
  });
});
