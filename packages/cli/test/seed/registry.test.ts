import { getDomain, listDomains, registerDomain } from '@fiks/domains';
import type { Domain } from '@fiks/interfaces';
import { describe, expect, test, vi } from 'vitest';
import { stubDomain } from './fixtures/stub.ts';

describe('@fiks/domains registry', () => {
  test('registerDomain / getDomain / listDomains round-trip a stub Domain', () => {
    const a = stubDomain('seed-stub-a');
    const b = stubDomain('seed-stub-b');
    registerDomain(b);
    registerDomain(a);
    expect(getDomain('seed-stub-a')).toBe(a);
    expect(getDomain('seed-stub-b')).toBe(b);
    const ids = listDomains().map((d) => d.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(expect.arrayContaining(['seed-stub-a', 'seed-stub-b']));
    // The hooks come back as registered.
    const got = getDomain('seed-stub-a');
    expect(got.allowedEditPaths).toEqual(['^src/.+\\.ts$']);
    expect(got.suite.scope).toEqual(['test/**']);
    const spec = {
      traceId: 'tr_1',
      propertyIds: ['p'],
      testPath: 'test/repro/tr_1.test.ts',
      tracePath: 'x.json',
    };
    const trace = {
      id: 'tr_1',
      capturedAt: got.frozenClock,
      tool: 't',
      args: {},
      http: [],
      runId: 'r',
      contractId: 'c',
      violated: [],
      server: { name: 's', transport: 'stdio' as const },
    };
    expect(got.reproEmitter(trace, spec).testPath).toBe('test/repro/tr_1.test.ts');
  });

  test("getDomain('nope') throws a clear error naming the registered domains", () => {
    registerDomain(stubDomain('seed-stub-c'));
    expect(() => getDomain('nope')).toThrow(/unknown domain "nope"; registered: .*seed-stub-c/);
  });

  test('re-registering the same object is a no-op; a second object under a taken id throws', () => {
    const d = stubDomain('seed-stub-d');
    registerDomain(d);
    expect(() => registerDomain(d)).not.toThrow();
    expect(() => registerDomain(stubDomain('seed-stub-d'))).toThrow(/"seed-stub-d" is already registered/);
    expect(getDomain('seed-stub-d')).toBe(d);
  });

  test('rejects an invalid id', () => {
    expect(() => registerDomain({ ...stubDomain('x'), id: 'Bad Id' } as Domain)).toThrow(/invalid domain id/);
  });

  test('one registry per process, even if the module is loaded twice', async () => {
    registerDomain(stubDomain('seed-stub-e'));
    vi.resetModules();
    const again = await import('../../../domains/src/registry.ts');
    expect(again.registerDomain).not.toBe(registerDomain);
    expect(again.getDomain('seed-stub-e').id).toBe('seed-stub-e');
  });
});
