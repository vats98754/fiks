#!/usr/bin/env node
// A stand-in for `pnpm fiks` in the runner's own tests (FIKS_EXP_FIKS_BIN, --dry only). It logs its
// argv and the env keys the runner sets, writes deterministic result files, and misbehaves on
// request:
//   STUB_LOG=<file>              append {argv, cwd, forbid, fiksDir} per call (JSONL)
//   STUB_SLEEP_MS=<n>            sleep before finishing an arm call
//   STUB_CAP_ONCE=<run-key>      exit 76 (usage cap) the first time that run key runs
//   STUB_INFRA=<run-key>:<n>     exit 75 (infra) the first n times that run key runs
//   STUB_STATE=<dir>             counters for the two above
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const env = process.env;
if (env.STUB_LOG) {
  appendFileSync(
    env.STUB_LOG,
    `${JSON.stringify({ argv, cwd: process.cwd(), forbid: env.FIKS_LLM_FORBID ?? null, fiksDir: env.FIKS_DIR ?? null, oauth: env.CLAUDE_CODE_OAUTH_TOKEN ? 'set' : null })}\n`,
  );
}
const cmd = argv[0];
const counter = (name) => {
  const dir = env.STUB_STATE;
  if (!dir) return 0;
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name.replace(/[^\w.-]+/g, '_'));
  const n = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0;
  writeFileSync(f, String(n + 1));
  return n;
};

if (cmd === 'enumerate' || cmd === 'record') {
  const out = val('--out');
  if (cmd === 'record') mkdirSync(out, { recursive: true });
  else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, '{}\n');
  }
  process.exit(0);
}
if (cmd === 'freeze-trace') {
  const out = val('--out');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ id: 'stub-trace', records: val('--records') })}\n`);
  process.exit(0);
}
if (cmd === 'repair' || cmd === 'arm') {
  const runKey = val('--run-key');
  const sleep = Number(env.STUB_SLEEP_MS ?? 0);
  if (sleep) await new Promise((r) => setTimeout(r, sleep));
  if (env.STUB_CAP_ONCE === runKey && counter(`cap-${runKey}`) === 0) {
    process.stderr.write('Claude AI usage limit reached|1893456000\n');
    process.exit(76);
  }
  if (env.STUB_INFRA) {
    const [k, n] = env.STUB_INFRA.split(':');
    if (k === runKey && counter(`infra-${runKey}`) < Number(n)) {
      process.stderr.write('API Error: 529 overloaded\n');
      process.exit(75);
    }
  }
  const dir = join(env.FIKS_DIR, 'runs', ...runKey.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'result.json'),
    `${JSON.stringify({ runKey, arm: cmd === 'repair' ? val('--arm') : val('--name'), stub: val('--agent-stub') ?? null })}\n`,
  );
  process.exit(0);
}
// Any other command (author, traffic, grade, ...) succeeds and writes nothing.
process.exit(0);
