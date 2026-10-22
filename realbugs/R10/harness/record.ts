// Records R10's trigger fixtures from the real prefix server process (labels: recorded).
//   1. Issue #4887 step 1 on an empty memory file: create Alice ("Works at Acme"); the file the
//      server wrote is saved as fixtures/state-alice.jsonl.
//   2. Issue step 2 on that state: create Alice ("Allergic to penicillin"); the call's result, the
//      open_nodes read-back and the blind contract's verdict are saved as fixtures/trigger.json.
// usage: pnpm tsx realbugs/R10/harness/record.ts [--sha prefix] [--out <dir>] [--force]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateCase, loadContract } from './check.ts';
import { BUG_DIR, type Case, prepareBuild, runCase } from './server.ts';

const ISSUE = 'https://github.com/modelcontextprotocol/servers/issues/4887';

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      sha: { type: 'string', default: 'prefix' },
      out: { type: 'string' },
      force: { type: 'boolean' },
    },
    strict: true,
  });
  const out = resolve(values.out ?? join(BUG_DIR, 'fixtures'));
  const stateFile = join(out, 'state-alice.jsonl');
  const triggerFile = join(out, 'trigger.json');
  if (!values.force && (existsSync(stateFile) || existsSync(triggerFile))) {
    console.error(`[record] ${out} already holds the fixtures; pass --force to overwrite`);
    return 2;
  }
  mkdirSync(out, { recursive: true });
  const build = await prepareBuild({ sha: values.sha });
  const capturedAt = new Date().toISOString();
  const step1: Case = {
    id: 'r10-issue-step1',
    capturedAt,
    tool: 'create_entities',
    args: { entities: [{ name: 'Alice', entityType: 'person', observations: ['Works at Acme'] }] },
    state: { lines: [] },
  };
  const s1 = await runCase(build, step1);
  if (s1.result.isError) throw new Error(`step 1 failed: ${JSON.stringify(s1.result)}`);
  writeFileSync(stateFile, s1.after);

  const trigger: Case = {
    id: 'r10-trigger',
    capturedAt,
    tool: 'create_entities',
    args: { entities: [{ name: 'Alice', entityType: 'person', observations: ['Allergic to penicillin'] }] },
    state: { memoryFile: 'state-alice.jsonl' },
    probe: { tool: 'open_nodes' },
  };
  const r = await runCase(build, { ...trigger, file: triggerFile });
  const evaluation = evaluateCase(loadContract(), r);
  const rec = {
    ...trigger,
    http: [],
    result: r.result,
    probe: r.probe,
    violated: evaluation.violations,
    target: evaluation.violations.map((v) => v.propertyId),
    recordedFrom: {
      sha: build.sha,
      server: 'node src/memory/dist/index.js',
      env: 'MEMORY_FILE_PATH',
      source: `${ISSUE} reproduction steps 1-2 (args verbatim)`,
    },
  };
  writeFileSync(triggerFile, `${JSON.stringify(rec, null, 2)}\n`);
  console.log(JSON.stringify({ stateFile, triggerFile, sha: build.sha, verdict: evaluation.verdict }));
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => {
    process.exitCode = c;
  },
  (e) => {
    console.error(`[record] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
