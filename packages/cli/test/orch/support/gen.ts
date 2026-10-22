// Fixture generators for the ORCH tests. Each runs the CORE harness (vendor v1 [+ INJ injector
// rule] -> tap -> tool server at a local base ref -> fiks-proxy) under the Domain's frozen clock,
// so the bytes are the same on every run (the regeneration tests assert byte-equality with the
// committed fixtures).
//  - traceThroughRule: the first fixture call with a drift-attributable violation (its property
//    verifies on a v1 control run of the same calls), saved in the product trace format
//    (packages/repro/src/trace-store.ts) with the injector-aware profile and target = [first
//    attributable property].
//  - cleanCorpus: the domain's v1 fixture calls as CallRecords (`@fiks/interfaces`), the clean
//    v1 corpus FIKS+CU's gate reads.
import '../../../src/bootstrap/00-shop.ts';
import '../../../src/bootstrap/10-tracker.ts';
import '../../../src/bootstrap/30-injector.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContractFile } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import { type LoadedRule, loadDriftPackage, readRule } from '@fiks/injector';
import type { CallRecord as PaperCallRecord } from '@fiks/interfaces';
import type { CallRecord } from '@fiks/proxy';
import { traceFromCall } from '@fiks/repro';
import { startHarness } from '../../../src/harness.ts';
import { ROOT, repoAt } from '../../../src/paths.ts';

export const ORCH_FIXTURES = join(ROOT, 'packages/cli/test/orch/fixtures');

export function loadRule(file: string): LoadedRule {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  return 'injectorRule' in raw ? loadDriftPackage(file).rule : readRule(file);
}

/** The contracts vendored in the tool repo at `ref` (what that base enforces). */
export function contractsAt(domain: string, ref: string): ContractFile {
  const dir = repoAt(ref, domain);
  const name = domain === 'shop' ? 'shop-mcp' : 'tracker-mcp';
  return JSON.parse(
    readFileSync(join(dir, `test/fiks/vendored/${name}.contracts.json`), 'utf8'),
  ) as ContractFile;
}

/**
 * Exchange timing is wall-clock and base-shop's create_order sends a random Idempotency-Key, so
 * both are pinned (startedAt = the frozen clock, 0 ms, a fixed key) for stable bytes. The key's
 * value plays no part in any contract or replay match (replay keys on header names).
 */
const FIXED_KEY = '00000000-0000-4000-8000-000000000000';
function freezeTiming(rec: CallRecord, at: string): CallRecord {
  const fix = <
    T extends { startedAt?: string; durationMs?: number; request: { headers: Record<string, string> } },
  >(
    e: T,
  ): T => {
    const headers = { ...e.request.headers };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'idempotency-key') headers[k] = FIXED_KEY;
    return { ...e, startedAt: at, durationMs: 0, request: { ...e.request, headers } };
  };
  return {
    ...rec,
    http: rec.http.map(fix),
    ...(rec.probe ? { probe: { ...rec.probe, http: rec.probe.http.map(fix) } } : {}),
  };
}

async function runCalls(o: {
  domain: string;
  ref: string;
  rule?: LoadedRule;
  contracts: ContractFile;
  calls: { tool: string; args: Record<string, unknown> }[];
}): Promise<CallRecord[]> {
  const d = getDomain(o.domain);
  const records: CallRecord[] = [];
  const h = await startHarness({
    vendor: 'v1',
    domain: o.domain,
    ...(o.rule ? { injector: o.rule } : {}),
    shopDir: repoAt(o.ref, o.domain),
    via: 'proxy',
    contracts: o.contracts,
    clock: new Date(d.frozenClock),
  });
  try {
    for (const c of o.calls) {
      const { record } = await h.call(c.tool, c.args);
      if (record) records.push(freezeTiming(record, d.frozenClock));
    }
  } finally {
    await h.close();
  }
  return records;
}

export async function traceThroughRule(o: {
  domain: string;
  /** Rule file or drift package manifest. */
  rule: string;
  /** Server ref (the drift package's base). */
  ref: string;
  contracts?: ContractFile;
  /** Default: the domain's v1 fixture calls. */
  calls?: { tool: string; args: Record<string, unknown> }[];
}): Promise<string> {
  const d = getDomain(o.domain);
  const rule = loadRule(o.rule);
  const contracts = o.contracts ?? contractsAt(o.domain, o.ref);
  const calls = o.calls ?? d.fixtureCalls.map(({ tool, args }) => ({ tool, args }));
  const drift = await runCalls({ domain: o.domain, ref: o.ref, rule, contracts, calls });
  const control = await runCalls({ domain: o.domain, ref: o.ref, contracts, calls });
  for (const [i, rec] of drift.entries()) {
    if (rec.receipt.verdict !== 'violated') continue;
    const c = control[i];
    const verifiedOnControl = (p: string) =>
      Boolean(c?.receipt.checked.includes(p) && !c.receipt.violations.some((v) => v.propertyId === p));
    const target = rec.receipt.violations.map((v) => v.propertyId).find(verifiedOnControl);
    if (!target) continue;
    const trace = traceFromCall(rec, {
      runId: 'run_orch_fixture',
      upstream: { version: 'v1', drifts: [], clock: d.frozenClock },
      server: { name: d.repo.slug.split('/').pop() ?? o.domain, transport: 'stdio' },
      target: [target],
      profile: { domain: o.domain, base: 'v1', ruleId: rule.id, ruleHash: rule.hash },
    });
    return `${JSON.stringify(trace, null, 2)}\n`;
  }
  throw new Error(`${rule.id}: no fixture call has a drift-attributable violation`);
}

/** The domain's v1 fixture calls at `ref`, as paper CallRecords (stratum dev, frozen clock). */
export async function cleanCorpus(domain: string, ref: string): Promise<Record<string, string>> {
  const d = getDomain(domain);
  const contracts = contractsAt(domain, ref);
  const recs = await runCalls({
    domain,
    ref,
    contracts,
    calls: d.fixtureCalls.map(({ tool, args }) => ({ tool, args })),
  });
  const out: Record<string, string> = {};
  for (const [i, r] of recs.entries()) {
    const slug = d.fixtureCalls[i]?.slug ?? String(i);
    const call = { tool: r.tool, args: r.args, output: r.result.structuredContent };
    const rec: PaperCallRecord = {
      callId: `clean-v1-${domain}-${slug}`,
      domain,
      stratum: 'dev',
      catalog: 'original',
      drift: null,
      mutant: null,
      tool: r.tool,
      args: r.args,
      upstream: r.http.map((e) => ({ request: e.request, response: e.response })),
      output: r.result,
      events: [
        {
          type: 'call',
          upstreamObserved: r.upstreamObserved,
          ...(r.probe ? { probe: r.probe } : {}),
          receipt: { verdict: r.receipt.verdict, checked: r.receipt.checked },
        },
      ],
      entityClass: d.entityClass(call),
      originUnit: d.originEntity(call),
      capturedAt: r.at,
      controlOf: null,
    };
    out[`${slug}.json`] = `${JSON.stringify(rec, null, 2)}\n`;
  }
  return out;
}
