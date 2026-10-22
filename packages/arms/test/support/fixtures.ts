// ARMS's own frozen-trace fixtures and their v1 controls (WORKSTREAMS ARMS; PLAN 3.0).
//
// Each trace is generated like ORCH's DEV-X1 fixture: the CORE harness (vendor v1 + the drift's INJ
// rule as upstream middleware, through fiks-proxy with the frozen contracts) on a checkout of the
// drift's base, under the Domain's frozen clock, saved with the existing trace store
// (packages/repro traceFromCall + saveTrace's serialization). The trace keeps the full receipt
// `violated` list; `target` = [the first drift-attributable entry], where a violation is
// drift-attributable iff its property verifies on the v1 control (the same call, same base, same
// clock and catalog, no injector rule).
//
//   pnpm tsx packages/arms/test/support/fixtures.ts --write   (re)writes the committed traces
//   pnpm tsx packages/arms/test/support/fixtures.ts --control prints the control verdicts (SIDECARS.md)
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ContractFile,
  findContract,
  type HttpExchange,
  type ToolContract,
  type Verdict,
} from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import type { Catalog, InjectorRule, IvExclusion, RerecordProfile } from '@fiks/interfaces';
import { createWorktree, traceFromCall } from '@fiks/repro';
import { startHarness } from '../../../cli/src/harness.ts';
import { loadDomains } from '../../src/domains.ts';
import type { IvSidecar } from '../../src/sidecar.ts';
import type { FrozenTraceFile } from '../../src/trace.ts';
import { registerArmsTestInjector } from './injector.ts';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url)).replace(/\/$/, '');
export const SHOP_DIR = process.env.FIKS_SHOP_DIR_CLONE ?? join(ROOT, '.work/shop-mcp');
export const TRACKER_DIR = process.env.FIKS_TRACKER_DIR ?? join(ROOT, '.work/tracker-mcp');
export const D2_TRACE = join(ROOT, 'packages/cli/test/core/fixtures/D2-trace.json');
export const ORACLES = join(ROOT, 'packages/cli/test/oracles');
export const TRACKER_STUB_CONTRACTS = join(ROOT, 'packages/vendor-tracker/fixtures/dev-stub.contracts.json');

export interface FixtureSpec {
  id: string;
  domain: 'shop' | 'tracker';
  /** Server base (a local ref of the domain's clone). */
  base: string;
  ruleFile: string;
  call: { tool: string; args: Record<string, unknown> };
  catalog?: Catalog;
  /** Extended entities (catalog `all`), as a JSON file. */
  extendedFile?: string;
  /** Frozen contracts (default: the domain's). */
  contractsFile?: string;
  file: string;
}

export const SPECS: Record<'D3' | 'D4' | 'D4-plantedfp' | 'TRK-DEV-1', FixtureSpec> = {
  D3: {
    id: 'D3',
    domain: 'shop',
    base: 'seed-v1',
    ruleFile: join(ROOT, 'packages/injector/fixtures/rules/D3.json'),
    // The shop D3 scenario call (packages/vendor-api/src/scenarios.ts).
    call: { tool: 'create_order', args: { items: [{ product_id: 'p-1004', quantity: 2 }] } },
    file: join(FIXTURES, 'D3.trace.json'),
  },
  D4: {
    id: 'D4',
    domain: 'shop',
    base: 'seed-v1',
    ruleFile: join(ROOT, 'packages/injector/fixtures/rules/D4.json'),
    call: { tool: 'search_products', args: { query: 'cable' } },
    file: join(FIXTURES, 'D4.trace.json'),
  },
  'D4-plantedfp': {
    id: 'D4-plantedfp',
    domain: 'shop',
    base: 'seed-v1',
    ruleFile: join(ROOT, 'packages/injector/fixtures/rules/D4.json'),
    // 4 original laptops + the extension's 2 laptops = 6 matches: the D4 page of 5 ends with the
    // $9 extended laptop (on the first page), the second page holds the in-range one.
    call: { tool: 'search_products', args: { query: 'laptop' } },
    catalog: 'all',
    extendedFile: join(FIXTURES, 'D4-plantedfp.extended.json'),
    file: join(FIXTURES, 'D4-plantedfp.trace.json'),
  },
  'TRK-DEV-1': {
    id: 'TRK-DEV-1',
    domain: 'tracker',
    base: 'dev-tracker-stub',
    ruleFile: join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1/rule.json'),
    // The first list_comments call of the tracker's v1 fixture calls (an issue with comments).
    call: { tool: 'list_comments', args: { issue_key: 'TRK-104' } },
    contractsFile: TRACKER_STUB_CONTRACTS,
    file: join(FIXTURES, 'TRK-DEV-1.trace.json'),
  },
};

/**
 * The tap stamps each exchange with the wall clock (`startedAt`, `durationMs`); under the frozen
 * clock they are set to the clock and 0, so a regeneration is byte-identical. Replay ignores both
 * (exchanges are matched by request key, ordered by `seq`).
 */
export function freezeExchangeTimes<T extends { http: HttpExchange[]; probe?: { http: HttpExchange[] } }>(
  t: T,
  clock: Date,
): T {
  const fix = (e: HttpExchange): HttpExchange => ({ ...e, startedAt: clock.toISOString(), durationMs: 0 });
  return {
    ...t,
    http: t.http.map(fix),
    ...(t.probe ? { probe: { ...t.probe, http: t.probe.http.map(fix) } } : {}),
  };
}

export const repoOf = (domain: string) => (domain === 'tracker' ? TRACKER_DIR : SHOP_DIR);

export function contractsFor(spec: Pick<FixtureSpec, 'domain' | 'contractsFile'>): ContractFile {
  const file = spec.contractsFile ?? getDomain(spec.domain).contractsPath;
  return JSON.parse(readFileSync(file, 'utf8')) as ContractFile;
}

/** Every property id of a contract, in evaluation order (outputSchema, invariants, postconditions). */
export function contractProperties(c: ToolContract, declaredSchema: boolean): string[] {
  return [
    ...(c.outputSchema || declaredSchema ? [`${c.id}/outputSchema`] : []),
    ...c.invariants.map((i) => `${c.id}/${i.id}`),
    ...(c.postconditions ?? []).map((p) => `${c.id}/${p.id}`),
  ];
}

export interface CallOutcome {
  checked: string[];
  violated: string[];
  receipt: { verdict: Verdict; checked: string[]; violations: { propertyId: string }[] };
}

const verdictOf = (o: CallOutcome, p: string): Verdict =>
  o.violated.includes(p) ? 'violated' : o.checked.includes(p) ? 'verified' : 'unverifiable';

/**
 * Runs one call through the harness (proxy, frozen contracts) on a checkout of `base`. With
 * `rule`, the injector applies it in front of vendor v1; without it, this is the v1 control.
 */
export async function runCall(
  spec: FixtureSpec,
  dir: string,
  rule: InjectorRule | undefined,
  clock: Date,
  onRecord?: (rec: Parameters<NonNullable<Parameters<typeof startHarness>[0]['onCall']>>[0]) => void,
): Promise<CallOutcome> {
  const prev = process.env.VENDOR_EXTENDED_CATALOG;
  if (spec.extendedFile) process.env.VENDOR_EXTENDED_CATALOG = spec.extendedFile;
  try {
    let receipt: CallOutcome['receipt'] | undefined;
    const h = await startHarness({
      vendor: 'v1',
      domain: spec.domain,
      catalog: spec.catalog,
      injector: rule,
      via: 'proxy',
      clock,
      shopDir: dir,
      contracts: contractsFor(spec),
      onCall: (rec) => {
        receipt = rec.receipt;
        onRecord?.(rec);
        return undefined;
      },
    });
    try {
      await h.call(spec.call.tool, spec.call.args);
    } finally {
      await h.close();
    }
    if (!receipt) throw new Error(`${spec.id}: no receipt`);
    return {
      checked: [...receipt.checked],
      violated: receipt.violations.map((v) => v.propertyId),
      receipt,
    };
  } finally {
    if (prev === undefined) delete process.env.VENDOR_EXTENDED_CATALOG;
    else process.env.VENDOR_EXTENDED_CATALOG = prev;
  }
}

export interface Generated {
  bytes: string;
  trace: FrozenTraceFile;
  control: CallOutcome;
  drift: CallOutcome;
  /** Sidecar derived from the control (what the hand-written one must equal, minus controlCallId). */
  derived: Omit<IvSidecar, 'controlCallId'>;
  /** Control verdict of every property of the triggering contract. */
  controlVerdicts: Record<string, Verdict>;
}

export async function generate(spec: FixtureSpec): Promise<Generated> {
  await loadDomains();
  registerArmsTestInjector();
  const domain = getDomain(spec.domain);
  const rule = JSON.parse(readFileSync(spec.ruleFile, 'utf8')) as InjectorRule;
  const clock = new Date(domain.frozenClock);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), `arms-fixture-${spec.id}-`)));
  const wt = createWorktree(repoOf(spec.domain), spec.base, { dir: join(tmp, 'repo') });
  try {
    const control = await runCall(spec, wt.dir, undefined, clock);
    let rec: Parameters<NonNullable<Parameters<typeof startHarness>[0]['onCall']>>[0] | undefined;
    const drift = await runCall(spec, wt.dir, rule, clock, (r) => {
      rec = r;
    });
    if (!rec) throw new Error(`${spec.id}: no call record`);
    const contract = findContract(contractsFor(spec), spec.call.tool);
    if (!contract) throw new Error(`${spec.id}: no contract for ${spec.call.tool}`);
    const props = contractProperties(contract, true);
    const controlVerdicts = Object.fromEntries(props.map((p) => [p, verdictOf(control, p)])) as Record<
      string,
      Verdict
    >;
    const attributable = drift.violated.filter((p) => controlVerdicts[p] === 'verified');
    if (!attributable.length) throw new Error(`${spec.id}: no drift-attributable violation`);
    const profile: RerecordProfile = {
      domain: spec.domain,
      base: 'v1',
      ruleId: rule.id,
      ruleHash: rule.hash,
    };
    const trace = freezeExchangeTimes(
      traceFromCall(rec, {
        runId: `arms-fixture-${spec.id}`,
        upstream: { version: 'v1', drifts: [], clock: clock.toISOString() },
        server: { name: `${spec.domain}-mcp`, transport: 'stdio', gitSha: wt.commit },
        target: [attributable[0] as string],
        profile,
      }),
      clock,
    );
    const ivExcluded: IvExclusion[] = props
      .filter((p) => controlVerdicts[p] !== 'verified')
      .map((p) => ({ property: p, controlVerdict: controlVerdicts[p] as Verdict }));
    return {
      bytes: `${JSON.stringify(trace, null, 2)}\n`,
      trace: trace as FrozenTraceFile,
      control,
      drift,
      controlVerdicts,
      derived: {
        attributableProperties: attributable,
        ivProperties: props.filter((p) => controlVerdicts[p] === 'verified'),
        ivExcluded,
      },
    };
  } finally {
    wt.remove();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The v1 control of an existing trace (the D2 fixture): the same call on the base server, vendor
 * v1, no drift, at the trace's own upstream clock.
 */
export async function controlOfTrace(
  trace: FrozenTraceFile,
  opts: { domain: string; base: string },
): Promise<{ derived: Omit<IvSidecar, 'controlCallId'>; controlVerdicts: Record<string, Verdict> }> {
  await loadDomains();
  const spec: FixtureSpec = {
    id: trace.id,
    domain: opts.domain as 'shop',
    base: opts.base,
    ruleFile: '',
    call: { tool: trace.tool, args: trace.args },
    file: '',
  };
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'arms-control-')));
  const wt = createWorktree(repoOf(opts.domain), opts.base, { dir: join(tmp, 'repo') });
  try {
    const control = await runCall(
      spec,
      wt.dir,
      undefined,
      new Date(trace.upstream?.clock ?? trace.capturedAt),
    );
    const contract = findContract(contractsFor(spec), trace.tool);
    if (!contract) throw new Error(`no contract for ${trace.tool}`);
    const props = contractProperties(contract, true);
    const controlVerdicts = Object.fromEntries(props.map((p) => [p, verdictOf(control, p)])) as Record<
      string,
      Verdict
    >;
    const violated = (trace.violated ?? []).map((v) => v.propertyId);
    return {
      controlVerdicts,
      derived: {
        attributableProperties: violated.filter((p) => controlVerdicts[p] === 'verified'),
        ivProperties: props.filter((p) => controlVerdicts[p] === 'verified'),
        ivExcluded: props
          .filter((p) => controlVerdicts[p] !== 'verified')
          .map((p) => ({ property: p, controlVerdict: controlVerdicts[p] as Verdict })),
      },
    };
  } finally {
    wt.remove();
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(argv: string[]) {
  const write = argv.includes('--write');
  for (const spec of Object.values(SPECS)) {
    const g = await generate(spec);
    console.log(
      `${spec.id}: ${g.trace.id} violated=[${g.drift.violated.join(', ')}] target=${JSON.stringify(g.trace.target)}`,
    );
    console.log(`  control verdicts: ${JSON.stringify(g.controlVerdicts)}`);
    console.log(`  derived sidecar: ${JSON.stringify(g.derived)}`);
    if (write) writeFileSync(spec.file, g.bytes);
  }
  const d2 = JSON.parse(readFileSync(D2_TRACE, 'utf8')) as FrozenTraceFile;
  const c = await controlOfTrace(d2, { domain: 'shop', base: 'seed-v1' });
  console.log(
    `D2: control verdicts ${JSON.stringify(c.controlVerdicts)}\n  derived sidecar: ${JSON.stringify(c.derived)}`,
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
