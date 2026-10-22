// `fiks grade` (HOLD; PLAN 3.0 held-out oracle, 3.2 accept matrix, 5.8).
//
//   fiks grade --pkg <manifest.json> [--patch <diff> ...] [--ref A|B|base ...]
//              --tools-image <img> [--repo-image <img>] [--purpose run|test]
//              [--traffic <tasks.json>] [--json] [--out <file>]
//       Grades patches (diffs against the drift's base) -> one GradeRecord per patch. Every head
//       runs in its own grading container (repo image + read-only fiks-tools, --network none).
//   fiks grade --accept <spec.json> --tools-image <img> [--repo-image <img>] [--purpose test] [--json]
//       The H2 accept matrix: spec = {pkg, alert, testSets: [{id, kind, files: [{path, from}]}],
//       patches: [{id, diff}]}, paths relative to the spec file.
//   fiks grade --observe --require-sandbox            (inside the grading container only)
//       Reads an ObserveRequest on stdin, runs the head's hidden tests, the differential and the
//       traffic replay, prints the observation after OBSERVE_SENTINEL.
//   fiks grade dev-traces [--check] [--only <id,...>]
//       Builder tool: captures each dev drift's frozen trace (first call with a drift-attributable
//       violation: violated under vendor v1 + the rule, verified on the v1 control), its
//       enumeration recordings, the fiks repro test set and a stub agent test, under
//       packages/heldout/fixtures/dev/<id>/. It runs the drift's base (seed-v1, base-shop,
//       dev-tracker-stub), never a candidate patch.
//
// Loading this module registers the injector factory unless ORCH's bootstrap already did
// (packages/heldout/src/injector-bridge.ts), so `rerecord-head` with a drift profile works.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ContractFile } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import type { ObserveRequest, SandboxFactory, TestSetKind } from '@fiks/heldout';
import { ensureInjectorFactory } from '@fiks/heldout/injector-bridge';
import type { CliCommandModule, InjectorRule } from '@fiks/interfaces';
import type { CallRecord } from '@fiks/proxy';
import { createWorktree, reproHooks, traceFromCall } from '@fiks/repro';
import { startHarness } from '../harness.ts';
import { ROOT } from '../paths.ts';

ensureInjectorFactory();

const DEV = join(ROOT, 'packages/heldout/fixtures/dev');

/** Dev packages: HOLD's own (D1-D5, DEV-X1) and DOM2's TRK-DEV-1. */
export const DEV_PACKAGES: Record<string, string> = {
  D1: join(DEV, 'D1/manifest.json'),
  D2: join(DEV, 'D2/manifest.json'),
  D3: join(DEV, 'D3/manifest.json'),
  D4: join(DEV, 'D4/manifest.json'),
  D5: join(DEV, 'D5/manifest.json'),
  'DEV-X1': join(DEV, 'DEV-X1/manifest.json'),
  'TRK-DEV-1': join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1.json'),
};

/** Contracts a dev capture evaluates with (tracker: DOM2's dev-only stub). */
function devContracts(domain: string): ContractFile | undefined {
  if (domain !== 'tracker') return undefined;
  return JSON.parse(
    readFileSync(join(ROOT, 'packages/vendor-tracker/fixtures/dev-stub.contracts.json'), 'utf8'),
  ) as ContractFile;
}

const EMPTY_CONTRACTS = (domain: string): ContractFile => ({ server: domain, version: 1, contracts: [] });

type Values = Record<string, string | boolean | string[] | undefined>;

// --- In-container observation ------------------------------------------------------------

async function observeMain(): Promise<number> {
  const heldout = await import('@fiks/heldout');
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const req = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ObserveRequest;
  const result = await heldout.observe(req, {
    domain: getDomain(req.domain),
    startHarness: async (o) => {
      const h = await startHarness({
        vendor: 'v1',
        domain: req.domain,
        injector: o.injector,
        clock: o.clock,
        shopDir: o.shopDir,
        contracts: EMPTY_CONTRACTS(req.domain),
      });
      return {
        vendor: h.vendor,
        call: async (tool, args) => ({ result: (await h.call(tool, args)).result }),
        close: () => h.close(),
      };
    },
  });
  process.stdout.write(`\n${heldout.OBSERVE_SENTINEL}${JSON.stringify(result)}\n`);
  return 0;
}

// --- Dev traces ----------------------------------------------------------------------------

async function captureCalls(
  domainId: string,
  base: string,
  rule: InjectorRule | undefined,
  calls: { tool: string; args: Record<string, unknown> }[],
): Promise<CallRecord[]> {
  const d = getDomain(domainId);
  const wt = createWorktree(d.repo.dir(), base);
  const out: CallRecord[] = [];
  try {
    const h = await startHarness({
      vendor: 'v1',
      domain: domainId,
      injector: rule,
      clock: new Date(d.frozenClock),
      shopDir: wt.dir,
      via: 'proxy',
      contracts: devContracts(domainId),
      onCall: (rec) => {
        out.push(rec);
        return undefined;
      },
    });
    try {
      for (const c of calls) await h.call(c.tool, c.args);
    } finally {
      await h.close();
    }
  } finally {
    wt.remove();
  }
  return out;
}

const violatedIds = (r: CallRecord) => r.receipt.violations.map((v) => v.propertyId);

/**
 * Committed fixtures must regenerate byte-identically: the tap's per-exchange wall-clock timing
 * (startedAt, durationMs) is replaced by the frozen capture instant and 0, and a random UUID in a
 * request header value (base-shop's Idempotency-Key) by the nil UUID. Replay matches method, URL,
 * body and header names, so nothing reads these values.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stableTiming<T>(rec: T, at: string): T {
  const fix = (xs: unknown) => {
    if (!Array.isArray(xs)) return;
    for (const x of xs as Record<string, unknown>[]) {
      if ('startedAt' in x) x.startedAt = at;
      if ('durationMs' in x) x.durationMs = 0;
      const headers = (x.request as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      for (const [k, v] of Object.entries(headers)) {
        if (UUID.test(v)) headers[k] = '00000000-0000-0000-0000-000000000000';
      }
    }
  };
  const r = structuredClone(rec) as { http?: unknown; probe?: { http?: unknown } };
  fix(r.http);
  fix(r.probe?.http);
  return r as T;
}

async function devTraces(check: boolean, only?: string[]): Promise<number> {
  const heldout = await import('@fiks/heldout');
  const { formatText } = await import('@fiks/heldout/dev');
  const changed: string[] = [];
  const write = (file: string, bytes: string) => {
    const old = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    if (old === bytes) return;
    changed.push(file.slice(ROOT.length + 1));
    if (!check) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  };
  const json = (name: string, v: unknown) => formatText(name, `${JSON.stringify(v, null, 2)}\n`);
  for (const [id, manifest] of Object.entries(DEV_PACKAGES)) {
    if (only && !only.includes(id)) continue;
    const p = await heldout.loadPackage(manifest);
    const d = getDomain(p.pkg.domain);
    const calls = d.fixtureCalls.map(({ tool, args }) => ({ tool, args }));
    const drifted = await captureCalls(p.pkg.domain, p.pkg.base, p.rule, calls);
    const control = await captureCalls(p.pkg.domain, p.pkg.base, undefined, calls);
    if (drifted.length !== calls.length || control.length !== calls.length)
      throw new Error(`${id}: captured ${drifted.length}/${control.length} of ${calls.length} calls`);
    // Drift-attributable: violated under the rule, evaluated and not violated on the v1 control.
    const attributable = (i: number) => {
      const c = control[i] as CallRecord;
      const onControl = new Set(violatedIds(c));
      return violatedIds(drifted[i] as CallRecord).filter(
        (v) => !onControl.has(v) && c.receipt.checked.includes(v),
      );
    };
    const index = drifted.findIndex((_, i) => attributable(i).length > 0);
    if (index === -1) throw new Error(`${id}: no call has a drift-attributable violation`);
    const first = drifted[index] as CallRecord;
    const profile = heldout.profileOf(p);
    const server = { name: d.repo.slug.split('/').pop() ?? d.id, transport: 'stdio' as const };
    const meta = (rec: CallRecord) => ({
      runId: `run_heldout_dev_${id}`,
      upstream: { version: 'v1', drifts: [] as string[], clock: rec.at },
      server,
      profile,
    });
    const target = [attributable(index)[0] as string];
    const trace = stableTiming(traceFromCall(first, { ...meta(first), target }), first.at);
    const dir = join(DEV, id);
    write(join(dir, 'trace.json'), json('trace.json', trace));
    drifted.forEach((rec, i) => {
      const slug = d.fixtureCalls[i]?.slug ?? String(i);
      write(
        join(dir, 'enum', `${slug}.json`),
        json(`${slug}.json`, stableTiming(traceFromCall(rec, meta(rec)), rec.at)),
      );
    });
    // The fiks test set: the repro FIKS emits from the frozen trace, in the repo's own layout.
    const emitted = reproHooks(p.pkg.domain).reproEmitter(trace, {
      traceId: trace.id,
      propertyIds: target,
      testPath: `test/repro/${trace.id}.test.ts`,
      tracePath: `test/repro/${trace.id}.json`,
    });
    for (const f of emitted.files) write(join(dir, 'fiks', f.path), String(f.bytes));
    // A stub agent-style test: loads the alert through the repo's replay helper (no inline
    // recording) and asserts the violated property, as REPRO-AGENT's task text asks (PLAN 5.5).
    const agent = `// Stub agent-style test (HOLD dev fixture): loads the alert .alerts/${trace.id}.json through the
// repository's replay helper and asserts ${target[0]} (PLAN 5.5 task text).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

test('the alert replays on this head and ${target[0]} holds', async () => {
  const rec = JSON.parse(readFileSync(new URL('../.alerts/${trace.id}.json', import.meta.url), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.unmatched, 'UNMATCHED_REQUEST').toEqual([]);
  expect(r.evaluation.violations.map((v) => v.propertyId)).not.toContain('${target[0]}');
});
`;
    write(join(dir, 'agent', `test/agent-${trace.id}.test.ts`), formatText('agent.test.ts', agent));
    write(
      join(dir, 'frozen.json'),
      json('frozen.json', {
        driftId: id,
        traceId: trace.id,
        callIndex: index,
        tool: trace.tool,
        violated: violatedIds(first),
        attributable: attributable(index),
        target,
        profile,
      }),
    );
    for (const sub of ['fiks/test/repro', 'agent/test']) {
      const at = join(dir, sub);
      if (!existsSync(at)) continue;
      for (const f of readdirSync(at).filter((f) => !f.includes(trace.id))) {
        changed.push(join(at, f).slice(ROOT.length + 1));
        if (!check) rmSync(join(at, f));
      }
    }
    console.error(`${id}: trace ${trace.id} = ${trace.tool} call ${index}, target ${target[0]}`);
  }
  for (const c of changed) console.log(`${check ? 'would change' : 'wrote'} ${c}`);
  return check && changed.length ? 1 : 0;
}

// --- Host grading --------------------------------------------------------------------------

async function sandboxFrom(values: Values, domain: string, base: string): Promise<SandboxFactory> {
  const heldout = await import('@fiks/heldout');
  const tools = values['tools-image'];
  if (typeof tools !== 'string') throw new Error('--tools-image <img> is required (the fiks-tools image)');
  const given = values['repo-image'];
  const repo =
    typeof given === 'string' ? given : await heldout.repoImageFor(getDomain(domain).repo.dir(), base);
  return heldout.dockerSandboxFactory({
    repoImage: repo,
    toolsImage: tools,
    purpose: values.purpose === 'test' ? 'test' : 'run',
  });
}

async function gradeMain(values: Values): Promise<number> {
  const heldout = await import('@fiks/heldout');
  if (typeof values.pkg !== 'string') {
    console.error(
      'usage: fiks grade --pkg <manifest> [--patch <diff>...] [--ref A|B|base] --tools-image <img>',
    );
    return 2;
  }
  const p = await heldout.loadPackage(values.pkg);
  const d = getDomain(p.pkg.domain);
  const traffic =
    typeof values.traffic === 'string' ? values.traffic : join(DEV, 'traffic', `${p.pkg.domain}.json`);
  const grader = new heldout.Grader(p, {
    sandbox: await sandboxFrom(values, p.pkg.domain, p.pkg.base),
    repoDir: d.repo.dir(),
    clock: d.frozenClock,
    traffic: JSON.parse(readFileSync(traffic, 'utf8')),
    log: (l) => console.error(l),
  });
  const patches: { id: string; diff: string }[] = [];
  for (const f of (values.patch as string[] | undefined) ?? []) {
    const id = typeof values.id === 'string' && patches.length === 0 ? values.id : f;
    patches.push({ id, diff: readFileSync(f, 'utf8') });
  }
  for (const r of (values.ref as string[] | undefined) ?? []) {
    if (r === 'base') patches.push({ id: `${p.pkg.id}/base`, diff: '' });
    else if (r === 'A') patches.push({ id: `${p.pkg.id}/refA`, diff: readFileSync(p.refA, 'utf8') });
    else if (r === 'B') patches.push({ id: `${p.pkg.id}/refB`, diff: readFileSync(p.refB, 'utf8') });
    else throw new Error(`--ref ${r}: want A, B or base`);
  }
  const out: unknown[] = [];
  for (const patch of patches) {
    const g = await grader.grade(patch);
    out.push(values.json ? g : g.record);
    const hash = heldout.gradeRecordHash(g.record).slice(0, 16);
    console.log(
      values.json
        ? JSON.stringify(g)
        : `${g.record.patchId}: ${g.record.correct ? 'correct' : 'incorrect'} [${g.record.reasons.join(', ')}] ${hash}`,
    );
  }
  if (typeof values.out === 'string') writeFileSync(values.out, `${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

interface AcceptSpec {
  pkg: string;
  alert: string;
  testSets: { id: string; kind: TestSetKind; files: { path: string; from: string }[] }[];
  patches: { id: string; diff: string }[];
}

async function acceptMain(values: Values): Promise<number> {
  const heldout = await import('@fiks/heldout');
  const specFile = resolve(values.accept as string);
  const at = (f: string) => resolve(dirname(specFile), f);
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as AcceptSpec;
  const p = await heldout.loadPackage(at(spec.pkg));
  const d = getDomain(p.pkg.domain);
  const alertBytes = readFileSync(at(spec.alert), 'utf8');
  const matrix = new heldout.AcceptMatrix(
    p,
    {
      sandbox: await sandboxFrom(values, p.pkg.domain, p.pkg.base),
      repoDir: d.repo.dir(),
      alert: { id: (JSON.parse(alertBytes) as { id: string }).id, bytes: alertBytes },
      log: (l) => console.error(l),
    },
    spec.testSets.map((s) => ({
      id: s.id,
      kind: s.kind,
      files: s.files.map((f) => ({ path: f.path, bytes: readFileSync(at(f.from), 'utf8') })),
    })),
  );
  const out: unknown[] = [];
  for (const patch of spec.patches) {
    const r = await matrix.accept({
      id: patch.id,
      diff: patch.diff ? readFileSync(at(patch.diff), 'utf8') : '',
    });
    out.push(r);
    console.log(
      values.json
        ? JSON.stringify(r)
        : `${r.patchId}: base ${r.baseOk ? 'ok' : 'FAIL'}; ${r.cells.map((c) => `${c.setId}=${c.accepted ? 'accept' : 'reject'}`).join(' ')}`,
    );
  }
  if (typeof values.out === 'string') writeFileSync(values.out, `${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

const command: CliCommandModule = {
  name: 'grade',
  describe: 'held-out oracle: grade patches, the H2 accept matrix, dev frozen traces (HOLD)',
  async run(argv) {
    if (argv[0] === 'dev-traces') {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: { check: { type: 'boolean', default: false }, only: { type: 'string' } },
      });
      return devTraces(values.check, values.only?.split(','));
    }
    const { values } = parseArgs({
      args: argv,
      options: {
        observe: { type: 'boolean', default: false },
        'require-sandbox': { type: 'boolean', default: false },
        pkg: { type: 'string' },
        patch: { type: 'string', multiple: true },
        ref: { type: 'string', multiple: true },
        id: { type: 'string' },
        accept: { type: 'string' },
        traffic: { type: 'string' },
        'tools-image': { type: 'string' },
        'repo-image': { type: 'string' },
        purpose: { type: 'string' },
        json: { type: 'boolean', default: false },
        out: { type: 'string' },
      },
    });
    if (values.observe) {
      if (!values['require-sandbox'] || process.env.FIKS_IN_SANDBOX !== '1') {
        console.error(
          'grade --observe runs candidate code: only inside the grading container (--require-sandbox)',
        );
        return 2;
      }
      return observeMain();
    }
    if (values.accept) return acceptMain(values);
    return gradeMain(values);
  },
};

export default command;
