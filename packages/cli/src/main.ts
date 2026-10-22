#!/usr/bin/env node
// The fiks CLI loader (PLAN P18): loads .env, imports bootstrap/*.ts in sorted file-name order
// (so NN-*.ts run by number), then dispatches. A default export {name, describe, run(argv)} in commands/*.ts wins over the
// legacy adapter legacy/<name>.ts; files without a default export are ignored.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CliCommandModule } from '@fiks/interfaces';
import { type LegacyCommand, USAGE } from './legacy/common.ts';

const SRC = new URL('.', import.meta.url).pathname;
const ROOT = new URL('../../../', import.meta.url).pathname;
const argv = process.argv.slice(2);

// Container-only commands (P1, P23): refuse outside the sandbox, and never read the host's .env.
const sandboxed = argv.includes('--require-sandbox');
if (sandboxed && process.env.FIKS_IN_SANDBOX !== '1') {
  console.error(
    'sandbox required: --require-sandbox runs only inside the per-attempt container (FIKS_IN_SANDBOX=1)',
  );
  process.exit(2);
}
// Credentials (CLAUDE_CODE_OAUTH_TOKEN) and settings come from .env; values are never printed.
if (!sandboxed && existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const tsFiles = (dir: string, pattern: RegExp) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => pattern.test(f))
        .sort()
    : [];
const load = (dir: string, file: string) => import(pathToFileURL(join(dir, file)).href);

for (const f of tsFiles(join(SRC, 'bootstrap'), /^(?!.*\.d\.ts$)[\w.-]+\.ts$/))
  await load(join(SRC, 'bootstrap'), f);

function isCommandModule(m: unknown): m is CliCommandModule {
  const c = m as Partial<CliCommandModule> | undefined;
  return typeof c?.name === 'string' && typeof c.run === 'function';
}

const commands = new Map<string, CliCommandModule>();
for (const f of tsFiles(join(SRC, 'commands'), /^[\w.-]+\.ts$/)) {
  const mod = await load(join(SRC, 'commands'), f);
  if (!isCommandModule(mod.default)) continue;
  const prev = commands.get(mod.default.name);
  if (prev) throw new Error(`two command modules are named ${mod.default.name} (commands/${f})`);
  commands.set(mod.default.name, mod.default);
}

const [command, ...rest] = argv;
if (!command) {
  console.error(USAGE);
  process.exit(0);
}
const found = commands.get(command);
const legacyFile = /^[a-z][a-z0-9-]*$/.test(command) && command !== 'common' ? `${command}.ts` : undefined;
const legacy =
  !found && legacyFile && existsSync(join(SRC, 'legacy', legacyFile))
    ? ((await load(join(SRC, 'legacy'), legacyFile)) as LegacyCommand)
    : undefined;
const run = found ?? legacy;
if (!run) {
  console.error(USAGE);
  process.exit(1);
}
const code = await run.run(rest);
if (typeof code === 'number') process.exitCode = code;
