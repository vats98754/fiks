// Live smoke of the LLM route. Claude items are [LIVE]: run them only through live-lock.
//
//   pnpm tsx packages/llm/src/live-lock.ts --run -- pnpm tsx packages/llm/src/smoke.ts --model claude-haiku-5-5
//     5 complete() calls with JSON schemas (each must parse), costUsd and tokens logged, then one
//     agentSession whose transcript must show settingSources: [], the given cwd and no web tools.
//   pnpm tsx packages/llm/src/smoke.ts --ollama
//     ollama smoke (no Claude call): JSON chat + MCP tool loop on the approved model, or an explicit
//     SKIP with the reason when the model is not approved, pulled or served.

import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { complete } from './complete.ts';
import { loadRootEnv } from './env.ts';
import { connectStdioMcp, ollamaChat, ollamaReadiness, ollamaToolLoop } from './ollama.ts';
import { agentSession, WEB_TOOLS } from './session.ts';

const SYSTEM = 'You answer with exactly the JSON object requested and nothing else.';

const PROMPTS: { prompt: string; schema: z.ZodType; check: (d: never) => boolean }[] = [
  {
    prompt: 'Return {"sum": <the sum of 17 and 25>}.',
    schema: z.object({ sum: z.number() }),
    check: (d: { sum: number }) => d.sum === 42,
  },
  {
    prompt: 'Return {"capital": <the capital city of France>}.',
    schema: z.object({ capital: z.string() }),
    check: (d: { capital: string }) => /paris/i.test(d.capital),
  },
  {
    prompt: 'Return {"primes": <the first five prime numbers as an array>}.',
    schema: z.object({ primes: z.array(z.number()).length(5) }),
    check: (d: { primes: number[] }) => d.primes.join(',') === '2,3,5,7,11',
  },
  {
    prompt: 'Classify the HTTP status 429. Return {"category": "client_error" | "server_error" | "success"}.',
    schema: z.object({ category: z.enum(['client_error', 'server_error', 'success']) }),
    check: (d: { category: string }) => d.category === 'client_error',
  },
  {
    prompt:
      'A price field changed from dollars (19.99) to integer cents. Return {"cents": <19.99 dollars in cents>, "unit": "cents"}.',
    schema: z.object({ cents: z.number().int(), unit: z.literal('cents') }),
    check: (d: { cents: number }) => d.cents === 1999,
  },
];

async function claudeSmoke(model: string, n: number, logPath: string): Promise<boolean> {
  let parsed = 0;
  let correct = 0;
  for (const [i, p] of PROMPTS.slice(0, n).entries()) {
    try {
      const r = await complete({
        model,
        system: SYSTEM,
        prompt: p.prompt,
        schema: p.schema,
        label: `smoke-${i + 1}`,
        logPath,
      });
      parsed++;
      if (p.check(r.data as never)) correct++;
      console.log(
        `[smoke] complete ${i + 1}/${n}: parsed=${JSON.stringify(r.data)} costUsd=${r.costUsd.toFixed(5)} tokens=${JSON.stringify(r.tokens)} turns=${r.turns} wallMs=${r.wallMs} spawnMs=${r.spawnMs ?? '-'}`,
      );
    } catch (e) {
      console.log(`[smoke] complete ${i + 1}/${n}: FAILED ${(e as Error).name}: ${(e as Error).message}`);
    }
  }
  console.log(`[smoke] JSON parsed ${parsed}/${n} (content correct ${correct}/${n}); cost log: ${logPath}`);

  const cwd = mkdtempSync(join(tmpdir(), 'fiks-smoke-cwd-'));
  writeFileSync(join(cwd, 'hello.txt'), 'fiks smoke marker 7f3a\n');
  const transcriptPath = join(cwd, '..', `${cwd.split('/').pop()}.transcript.jsonl`);
  const s = await agentSession({
    cwd,
    model,
    prompt: 'Read hello.txt in the current directory and reply with its exact contents.',
    allowedTools: ['Read', 'Glob'],
    budget: { maxTurns: 4, maxBudgetUsd: 0.25, timeoutMs: 5 * 60_000 },
    transcriptPath,
    label: 'smoke-session',
    logPath,
  });
  const lines = readFileSync(transcriptPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  const header = lines.find((l) => l.type === 'fiks_session_header') ?? {};
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? {};
  const initTools = (init.tools as string[] | undefined) ?? [];
  const checks = {
    settingSourcesEmpty: JSON.stringify(header.settingSources) === '[]',
    headerCwd: header.cwd === cwd,
    initCwd: realpathSync(String(init.cwd ?? '/nonexistent')) === realpathSync(cwd),
    noWebToolsAllowed: !(header.allowedTools as string[]).some((t) =>
      (WEB_TOOLS as readonly string[]).includes(t),
    ),
    noWebToolsInInit: !initTools.some((t) => (WEB_TOOLS as readonly string[]).includes(t)),
    webToolsDisallowed: JSON.stringify(header.disallowedTools) === JSON.stringify([...WEB_TOOLS]),
    answered: s.ok && s.result.includes('7f3a'),
  };
  console.log(
    `[smoke] agentSession outcome=${s.outcome} costUsd=${s.costUsd.toFixed(5)} tokens=${JSON.stringify(s.tokens)} turns=${s.turns} spawnMs=${s.spawnMs ?? '-'}`,
  );
  console.log(`[smoke] transcript ${transcriptPath}`);
  console.log(`[smoke] header settingSources=${JSON.stringify(header.settingSources)} cwd=${header.cwd}`);
  console.log(`[smoke] init tools=${JSON.stringify(initTools)}`);
  console.log(`[smoke] session checks ${JSON.stringify(checks)}`);
  return parsed === n && Object.values(checks).every(Boolean);
}

async function ollamaSmoke(): Promise<boolean> {
  const ready = await ollamaReadiness();
  if (!ready.ready) {
    console.log(`[smoke] ollama SKIP: ${ready.reason}`);
    return true;
  }
  console.log(`[smoke] ollama model ${ready.model} digest ${ready.digest}`);
  const chat = await ollamaChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Return {"sum": <the sum of 17 and 25>}.' },
    ],
    responseFormat: 'json_object',
    temperature: 0,
    maxTokens: 64,
    label: 'smoke-ollama',
  });
  let jsonOk = false;
  try {
    jsonOk = z.object({ sum: z.number() }).safeParse(JSON.parse(chat.message.content ?? '')).success;
  } catch {
    jsonOk = false;
  }
  console.log(
    `[smoke] ollama chat json=${jsonOk} content=${JSON.stringify(chat.message.content)} completionTokens=${chat.completionTokens} tokensPerSec=${chat.tokensPerSec.toFixed(1)}`,
  );
  const server = fileURLToPath(new URL('./fixtures/calc-mcp.mjs', import.meta.url));
  const mcp = await connectStdioMcp({ command: process.execPath, args: [server] });
  try {
    const loop = await ollamaToolLoop({
      mcp,
      system: 'Use the add tool for arithmetic, then answer with the number only.',
      prompt: 'What is 1234 + 4321?',
      maxTurns: 4,
      label: 'smoke-ollama-tools',
    });
    const calledAdd = loop.calls.some((c) => c.name === 'add' && c.ok);
    console.log(
      `[smoke] ollama tool loop calls=${JSON.stringify(loop.calls.map((c) => ({ name: c.name, args: c.args, ok: c.ok })))} answer=${JSON.stringify(loop.answer)} turns=${loop.turns}`,
    );
    return jsonOk && calledAdd && (loop.answer ?? '').includes('5555');
  } finally {
    await mcp.close?.();
  }
}

async function main(argv: string[]): Promise<number> {
  let model = 'claude-haiku-5-5';
  let n = 5;
  let logPath = join(mkdtempSync(join(tmpdir(), 'fiks-smoke-')), 'llm-calls.jsonl');
  let ollamaOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--model') model = argv[++i] ?? model;
    else if (f === '--n') n = Math.min(PROMPTS.length, Number(argv[++i]));
    else if (f === '--log') logPath = argv[++i] ?? logPath;
    else if (f === '--ollama') ollamaOnly = true;
    else throw new Error(`unknown flag ${f}`);
  }
  if (ollamaOnly) return (await ollamaSmoke()) ? 0 : 1;
  loadRootEnv();
  const ok = await claudeSmoke(model, n, logPath);
  console.log(ok ? '[smoke] PASS' : '[smoke] FAIL');
  return ok ? 0 : 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === self) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[smoke] ${(e as Error).stack ?? e}`);
      process.exit(1);
    },
  );
}
