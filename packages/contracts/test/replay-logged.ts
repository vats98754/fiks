// Replays logged CallRecords through the evaluator to show the vocabulary changes moved no verdict.
//   pnpm tsx packages/contracts/test/replay-logged.ts [dir ...] [--no-live]
// 1. Every bench/results/<run>/proxy/*.jsonl CallRecord under the given dirs (default
//    bench/results) is re-evaluated by the current evaluator with the same input the proxy had
//    (`now` = the record's `at`, upstream and probe exchanges, the tools/list outputSchema of the
//    run's shop-mcp sha) and compared with the logged receipt: verdict, checked[], violations.
//    It is also evaluated by the old evaluator (shop-mcp seed-v1 vendored copy = fiks ec241bc):
//    the two results must be byte-identical.
// 2. The D1–D5 scenario traces (committed fixtures, and a fresh live run unless --no-live) go
//    through the old and the new evaluator: byte-identical results.
// Exit 0 only when there are 0 verdict changes and 0 old/new differences.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { shopDir } from '../../cli/src/paths.ts';
import { evaluate, findContract, SHOP_CONTRACTS } from '../src/index.ts';
import type { EvalResult, JsonSchema } from '../src/types.ts';
import {
  captureScenarios,
  declaredSchemas,
  type ScenarioRecord,
  type ToolSchemas,
} from './capture-scenarios.ts';
import { type Evaluator, inputOf, type LoggedCall, vendoredEvaluator } from './replay-lib.ts';

const root = new URL('../../../', import.meta.url).pathname;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'no-live': { type: 'boolean', default: false } },
});
const dirs = positionals.length ? positionals : ['bench/results'];

const old: Evaluator = await vendoredEvaluator(shopDir(), 'seed-v1');
const runNew = (tool: string, input: ReturnType<typeof inputOf>) =>
  evaluate(findContract(SHOP_CONTRACTS, tool), input);
const runOld = (tool: string, input: ReturnType<typeof inputOf>) =>
  old.evaluate(findContract(old.contracts, tool), input);
const sameContracts = JSON.stringify(old.contracts) === JSON.stringify(SHOP_CONTRACTS);
console.log(`old evaluator: ${old.source}; contracts identical to packages/contracts: ${sameContracts}`);

/** Every `proxy/*.jsonl` under `dir`, with its run's meta.json. */
function proxyLogs(dir: string): { file: string; meta: { shopMcpSha?: string } }[] {
  const out: { file: string; meta: { shopMcpSha?: string } }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (!statSync(p).isDirectory()) continue;
      if (name === 'proxy') {
        const metaPath = join(d, 'meta.json');
        const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
        for (const f of readdirSync(p).sort()) if (f.endsWith('.jsonl')) out.push({ file: join(p, f), meta });
      } else walk(p);
    }
  };
  walk(dir);
  return out;
}

const schemaCache = new Map<string, ToolSchemas>();
async function schemasAt(sha: string): Promise<ToolSchemas> {
  let s = schemaCache.get(sha);
  if (!s) {
    s = await declaredSchemas(sha);
    schemaCache.set(sha, s);
  }
  return s;
}

const ids = (r: EvalResult) => r.violations.map((v) => `${v.propertyId}@${v.path}`).sort();
let records = 0;
let verdictChanges = 0;
let detailChanges = 0;
let oldNewDiffs = 0;
const byVerdict: Record<string, number> = {};
for (const dir of dirs) {
  for (const { file, meta } of proxyLogs(join(root, dir))) {
    if (!meta.shopMcpSha) throw new Error(`${file}: run meta.json has no shopMcpSha`);
    const schemas = await schemasAt(meta.shopMcpSha);
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line) as LoggedCall & { type?: string };
      if (rec.type !== 'call' || !rec.receipt) continue;
      records++;
      const input = inputOf(rec, schemas.tools[rec.tool] as JsonSchema | undefined);
      const now = runNew(rec.tool, input);
      const before = runOld(rec.tool, input);
      byVerdict[now.verdict] = (byVerdict[now.verdict] ?? 0) + 1;
      const where = `${file.replace(root, '')} ${rec.tool}`;
      if (now.verdict !== rec.receipt.verdict) {
        verdictChanges++;
        console.log(`VERDICT CHANGE ${where}: logged ${rec.receipt.verdict}, now ${now.verdict}`);
      }
      const loggedIds = rec.receipt.violations.map((v) => `${v.propertyId}@${v.path}`).sort();
      if (
        JSON.stringify([...rec.receipt.checked].sort()) !== JSON.stringify([...now.checked].sort()) ||
        JSON.stringify(loggedIds) !== JSON.stringify(ids(now))
      ) {
        detailChanges++;
        console.log(`DETAIL CHANGE ${where}: checked/violations differ from the logged receipt`);
      }
      if (JSON.stringify(now) !== JSON.stringify(before)) {
        oldNewDiffs++;
        console.log(`OLD/NEW DIFF ${where}`);
      }
    }
  }
}
console.log(
  `logged CallRecords: ${records} (${Object.entries(byVerdict)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}); verdict changes vs logged receipts: ${verdictChanges}; ` +
    `checked/violation-id changes: ${detailChanges}; old vs new evaluator differences: ${oldNewDiffs}`,
);

async function scenarioPass(label: string, recs: ScenarioRecord[], schemas: ToolSchemas) {
  let diffs = 0;
  const rows: string[] = [];
  for (const rec of recs) {
    const input = inputOf(rec, schemas.tools[rec.tool] as JsonSchema | undefined);
    const now = runNew(rec.tool, input);
    const before = runOld(rec.tool, input);
    if (JSON.stringify(now) !== JSON.stringify(before)) {
      diffs++;
      console.log(`OLD/NEW DIFF ${label} ${rec.scenario} ${rec.tool}`);
    }
    if (rec.scenario !== 'v1-all')
      rows.push(
        `${rec.scenario}:${now.verdict}[${now.violations.map((v) => v.propertyId.split('/')[1]).join(',')}]`,
      );
  }
  const v1 = recs.filter((r) => r.scenario === 'v1-all');
  const v1Violated = v1.filter(
    (r) => runNew(r.tool, inputOf(r, schemas.tools[r.tool] as JsonSchema | undefined)).verdict === 'violated',
  ).length;
  console.log(
    `${label} scenario traces: ${recs.length} records; old vs new differences: ${diffs}; ` +
      `${rows.join(' ')}; v1-all violated: ${v1Violated}/${v1.length}`,
  );
  return diffs;
}

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
oldNewDiffs += await scenarioPass(
  'fixture',
  fixture('scenario-records.json') as ScenarioRecord[],
  fixture('tool-schemas.seed-v1.json') as ToolSchemas,
);
if (!values['no-live']) {
  oldNewDiffs += await scenarioPass('live', await captureScenarios(), await schemasAt('seed-v1'));
}

const ok = verdictChanges === 0 && oldNewDiffs === 0;
console.log(ok ? 'RESULT: 0 verdict changes, old and new evaluators identical' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
