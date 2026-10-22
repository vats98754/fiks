// stub-fiks.mjs plus an LLMR probe: every arm call asks LLMR whether an LLM call may run. With
// FIKS_LLM_FORBID=1, complete() must throw LlmForbiddenError before any I/O; the call counter
// counts only calls LLMR would have let through (it never contacts a model either way).
import { appendFileSync } from 'node:fs';
import { assertLlmAllowed, complete, LlmForbiddenError } from '@fiks/llm';

const counter = process.env.STUB_LLM_COUNT;
const cmd = process.argv[2];
if (counter && (cmd === 'repair' || cmd === 'arm')) {
  let allowed = true;
  try {
    assertLlmAllowed('stub-arm');
  } catch (e) {
    if (!(e instanceof LlmForbiddenError)) throw e;
    allowed = false;
  }
  if (allowed) appendFileSync(counter, 'call\n');
  else {
    // The real entry point refuses too, before any network call.
    try {
      await complete({ model: 'claude-haiku-5-5', system: 's', prompt: 'p' });
      appendFileSync(counter, 'call\n');
    } catch (e) {
      if (!(e instanceof LlmForbiddenError)) appendFileSync(counter, `unexpected ${String(e)}\n`);
    }
  }
}
// A plain .mjs with no types: imported by a computed specifier.
const stub = './stub-fiks.mjs';
await import(stub);
