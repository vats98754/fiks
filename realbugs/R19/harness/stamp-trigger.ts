// Turns the synthesized trigger fixture into a trace (the input of `fiks repro`): replays it once
// through the prefix head and writes what that replay observed into the fixture, as `result` (the
// tool's text result), `violated` (every violation) and `target` (the count property). Run after
// synth-fixtures.ts; the request/response exchanges are not touched.
//
// usage: pnpm tsx realbugs/R19/harness/stamp-trigger.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { ensureHead, resolveSha } from './heads.ts';
import { COUNT_PROPERTY, replayOnce } from './replay.ts';
import { TRIGGER } from './run.ts';

async function main(): Promise<number> {
  const head = ensureHead(resolveSha('prefix'));
  const fixture = JSON.parse(readFileSync(TRIGGER, 'utf8')) as Record<string, unknown>;
  const { result: _r, violated: _v, target: _t, ...rest } = fixture;
  const { outcome, raw } = await replayOnce(rest as never, head);
  if (!outcome.countFailure) {
    console.error(`[r19] prefix replay did not violate ${COUNT_PROPERTY}: ${JSON.stringify(outcome)}`);
    return 1;
  }
  const stamped = {
    ...rest,
    result: { content: raw.result.content, isError: raw.result.isError ?? false },
    violated: raw.evaluation.violations,
    target: [COUNT_PROPERTY],
  };
  writeFileSync(TRIGGER, `${JSON.stringify(stamped, null, 2)}\n`);
  console.log(`stamped ${TRIGGER}: violated=[${outcome.violated.join(',')}] target=${COUNT_PROPERTY}`);
  return 0;
}

main().then(
  (c) => {
    process.exitCode = c;
  },
  (e) => {
    console.error(e);
    process.exitCode = 2;
  },
);
