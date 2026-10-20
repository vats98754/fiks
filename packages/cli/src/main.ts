#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bench } from './commands/bench.ts';
import { callOnce } from './commands/call.ts';
import { confirm } from './commands/confirm.ts';
import { demo } from './commands/demo.ts';
import { recordFixtures } from './commands/record-fixtures.ts';
import { repair } from './commands/repair.ts';
import { repro } from './commands/repro.ts';
import { ROOT } from './paths.ts';

// Credentials (CLAUDE_CODE_OAUTH_TOKEN) and settings come from .env; values are never printed.
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

import { rerecord } from './commands/rerecord.ts';
import { runScenario, SCENARIOS } from './commands/scenario.ts';
import { summarize } from './commands/summarize.ts';
import { vendorDiff } from './commands/vendor-diff.ts';

const USAGE = `usage: fiks <command> [options]

commands:
  vendor-diff [--json]                     compare vendor v1 and v2 (spec and behavior)
  record-fixtures --vendor v1 [--out dir]  record baseline fixtures into shop-mcp
  rerecord <recording.json>...             re-record calls through the current shop-mcp code
  scenario <id> [--transport stdio|http]   run a scripted scenario through fiks-proxy (ids: v1-all, D1..D5)
  call <tool> '<json args>' [--vendor v2] [--drifts D2] [--compare-direct]
                                           one call through fiks-proxy
  repro --scenario D2 [--target seed-v1] [--runs 3] [--keep]
                                           capture a trace, generate its repro test, run the F gate
  repair --scenario D2 [--base main] [--no-pr] [--model claude-opus-5-5]
                                           repro -> repair agent -> gates -> green CI -> PR (never merges)
  confirm                                  after a human merge: re-run each repaired drift on main
  bench --phase A|B|C --k 5 [--tasks T1,T6] [--model m] [--shop-ref pr-heads] [--direct] [--out dir]
                                           agent trials through fiks-proxy; logs to bench/results/<runId>
  demo [--drifts D1,D2,D3] [--base fresh|main] [--until-f-gate]
                                           the whole loop per drift; prints PR URLs, never merges
  summarize [--check]                      bench/results/summary.json from logs only (--check: rebuild and compare)`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    vendor: { type: 'string', default: 'v1' },
    out: { type: 'string' },
    drifts: { type: 'string' },
    transport: { type: 'string', default: 'stdio' },
    'compare-direct': { type: 'boolean', default: false },
    scenario: { type: 'string' },
    target: { type: 'string', default: 'seed-v1' },
    runs: { type: 'string', default: '3' },
    keep: { type: 'boolean', default: false },
    base: { type: 'string', default: 'main' },
    'no-pr': { type: 'boolean', default: false },
    model: { type: 'string' },
    trace: { type: 'string' },
    phase: { type: 'string' },
    k: { type: 'string', default: '5' },
    tasks: { type: 'string' },
    'shop-ref': { type: 'string' },
    check: { type: 'boolean', default: false },
    'until-f-gate': { type: 'boolean', default: false },
    direct: { type: 'boolean', default: false },
    'no-receipt-field': { type: 'boolean', default: false },
  },
});

function print(data: unknown, human: () => string) {
  console.log(values.json ? JSON.stringify(data, null, 2) : human());
}

switch (command) {
  case 'vendor-diff': {
    const r = await vendorDiff();
    print(r, () =>
      [
        `openapi.json identical: ${r.openapiIdentical}`,
        ...r.behaviorDiffs.map(
          (d) => `${d.drift} ${d.title}: ${d.probe}: v1=${JSON.stringify(d.v1)} v2=${JSON.stringify(d.v2)}`,
        ),
      ].join('\n'),
    );
    break;
  }
  case 'record-fixtures': {
    const r = await recordFixtures({
      vendor: values.vendor === 'v2' ? 'v2' : 'v1',
      drifts: values.drifts,
      out: values.out,
    });
    print(r, () => `wrote ${r.written.length} fixtures to ${r.out}`);
    break;
  }
  case 'rerecord': {
    const done: Awaited<ReturnType<typeof rerecord>>[] = [];
    for (const f of positionals) done.push(await rerecord(resolve(f)));
    print(done, () => done.map((d) => `wrote ${d.file} (vendor ${d.vendor})`).join('\n'));
    break;
  }
  case 'scenario': {
    const id = positionals[0] ?? '';
    if (!SCENARIOS[id]) {
      console.error(`unknown scenario ${JSON.stringify(id)}; known: ${Object.keys(SCENARIOS).join(', ')}`);
      process.exit(2);
    }
    const r = await runScenario(id, {
      transport: values.transport === 'http' ? 'http' : 'stdio',
      shopRef: values['shop-ref'],
    });
    print(r, () =>
      [
        `scenario ${r.scenario} (vendor ${r.vendor} drifts=[${r.drifts.join(',')}], ${r.transport})`,
        ...r.calls.map((c) => `  ${c.tool} ${JSON.stringify(c.args)}\n    ${c.text}`),
      ].join('\n'),
    );
    break;
  }
  case 'call': {
    const [tool, json] = positionals;
    if (!tool) {
      console.error(USAGE);
      process.exit(2);
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(json ?? '{}');
    } catch {
      console.error(`arguments must be a JSON object, got ${JSON.stringify(json)}`);
      process.exit(2);
    }
    const r = await callOnce({
      tool,
      args,
      vendor: values.vendor === 'v2' ? 'v2' : 'v1',
      drifts: values.drifts,
      transport: values.transport === 'http' ? 'http' : 'stdio',
      compareDirect: values['compare-direct'],
      shopRef: values['shop-ref'],
    });
    print(r, () => {
      const last = r.result.content?.at(-1) as { text?: string } | undefined;
      const lines = [last?.text ?? '(no receipt)'];
      if (r.upstreamIdentical !== undefined)
        lines.push(`upstream result identical to a direct call: ${r.upstreamIdentical}`);
      return lines.join('\n');
    });
    break;
  }
  case 'repro': {
    if (!values.scenario) {
      console.error(USAGE);
      process.exit(2);
    }
    const r = await repro({
      scenario: values.scenario,
      ref: values.target,
      runs: Number(values.runs),
      keep: values.keep,
    });
    print(r, () =>
      [
        `trace ${r.trace.id}: ${r.trace.tool} ${JSON.stringify(r.trace.args)} violated ${r.trace.violated.join(', ')}`,
        `repro test ${r.spec.testPath} (target ${r.spec.propertyIds.join(', ')})`,
        `F gate on ${values.target}: ${r.gateF.ok ? 'PASS' : 'FAIL'}: ${r.gateF.reason}`,
        ...r.gateF.evidence.failed.map((f) => `  failing: ${f.test}\n    ${f.message.split('\n')[0]}`),
      ].join('\n'),
    );
    if (!r.gateF.ok) process.exitCode = 1;
    break;
  }
  case 'repair': {
    if (!values.scenario && !values.trace) {
      console.error(USAGE);
      process.exit(2);
    }
    const r = await repair({
      scenario: values.scenario,
      traceFile: values.trace,
      base: values.base,
      noPr: values['no-pr'],
      model: values.model,
    });
    print(r, () =>
      [
        `${r.status}: ${r.reason}`,
        `trace ${r.traceId} -> branch ${r.branch} (${r.attempts} attempt(s), runner ${r.runner ?? '-'}, ${r.turns} turns)`,
        ...r.gates.map((g) => `  ${g.ok ? 'PASS' : 'FAIL'} ${g.gate}: ${g.reason}`),
        r.pr ? `PR: ${r.pr.url}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    if (r.status !== 'pr_opened' && r.status !== 'ready') process.exitCode = 1;
    break;
  }
  case 'confirm': {
    const r = await confirm();
    print(r, () =>
      r.length
        ? r
            .map(
              (c) =>
                `${c.scenario ?? c.traceId}: ${c.confirmed ? 'CONFIRMED' : c.merged ? 'NOT CONFIRMED' : 'not merged'} (${c.reason}) ${c.pr}`,
            )
            .join('\n')
        : 'no fiks PRs found in .fiks/repairs',
    );
    break;
  }
  case 'bench': {
    const phase = values.phase as 'A' | 'B' | 'C';
    if (values['shop-ref'] !== undefined && values['shop-ref'] !== 'pr-heads') {
      console.error(`--shop-ref only accepts pr-heads (phase C), got ${JSON.stringify(values['shop-ref'])}`);
      process.exit(2);
    }
    if (!['A', 'B', 'C'].includes(phase)) {
      console.error(USAGE);
      process.exit(2);
    }
    const r = await bench({
      phase,
      k: Number(values.k),
      tasks: values.tasks?.split(','),
      model: values.model,
      shopRef: values['shop-ref'] === 'pr-heads' ? 'pr-heads' : undefined,
      out: values.out,
      direct: values.direct,
      noReceiptField: values['no-receipt-field'],
      onTrial: (t) => {
        if (!values.json) console.error(`${t.phase} ${t.taskId} #${t.trial}: ${t.outcome} (${t.reason})`);
      },
    });
    print(
      r,
      () => `${r.runId}: ${r.trials.filter((t) => t.pass).length}/${r.trials.length} passed -> ${r.out}`,
    );
    break;
  }
  case 'demo': {
    const r = await demo({
      drifts: (values.drifts ?? 'D1,D2,D3').split(','),
      base: values.base === 'fresh' ? 'fresh' : 'main',
      untilFGate: values['until-f-gate'],
    });
    print(r, () =>
      [
        `base branch: ${r.base}`,
        ...r.results.map((x) => `${x.scenario}: ${x.status} ${x.pr ?? ''} (${x.reason})`),
        r.missing ? `missing: ${r.missing}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const want = r.credential && !values['until-f-gate'] ? 'pr_opened' : 'ready';
    if (r.missing || r.results.some((x) => x.status !== want)) process.exitCode = 1;
    break;
  }
  case 'summarize': {
    const r = summarize({ check: values.check });
    print(values.check ? { ok: r.ok, diff: r.diff } : r.summary, () =>
      values.check ? (r.ok ? 'summary.json matches the logs' : (r.diff ?? 'mismatch')) : `wrote ${r.file}`,
    );
    if (!r.ok) process.exitCode = 1;
    break;
  }
  default:
    console.error(USAGE);
    process.exit(command ? 1 : 0);
}
