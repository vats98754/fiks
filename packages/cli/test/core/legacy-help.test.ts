// Legacy adapters (P18): help() is byte-identical to that command's line(s) of the ec241bc
// USAGE string (extracted from git at test time), `fiks` alone prints the full ec241bc USAGE,
// and `<command> --help` prints help() for every command without a default-export module.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CliCommandModule } from '@fiks/interfaces';
import { expect, test } from 'vitest';
import { CLI_SRC, ec241bcUsage, runCli, usageByCommand } from './support/cli.ts';

const ADAPTERS = [
  'vendor-diff',
  'record-fixtures',
  'rerecord',
  'scenario',
  'call',
  'repro',
  'repair',
  'confirm',
  'bench',
  'demo',
  'summarize',
];

const legacyNames = () =>
  readdirSync(join(CLI_SRC, 'legacy'))
    .filter((f) => f.endsWith('.ts') && f !== 'common.ts')
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();

test('(a) every adapter help() is exactly its ec241bc USAGE line(s)', async () => {
  const usage = usageByCommand(ec241bcUsage());
  expect([...usage.keys()].sort()).toEqual([...ADAPTERS].sort());
  expect(legacyNames()).toEqual([...ADAPTERS].sort());
  for (const name of ADAPTERS) {
    const mod = (await import(pathToFileURL(join(CLI_SRC, 'legacy', `${name}.ts`)).href)) as {
      name: string;
      help(): string;
    };
    expect(mod.name).toBe(name);
    expect(mod.help(), name).toBe(usage.get(name));
  }
}, 120_000);

test('(b) `fiks` with no command prints the ec241bc USAGE byte-identically', () => {
  const r = runCli([]);
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('');
  expect(r.stderr).toBe(`${ec241bcUsage()}\n`);
}, 60_000);

test('(c) `<command> --help` prints help() for commands without a default-export module', async () => {
  const overridden = new Set<string>();
  for (const f of readdirSync(join(CLI_SRC, 'commands')).filter((x) => x.endsWith('.ts'))) {
    const mod = (await import(pathToFileURL(join(CLI_SRC, 'commands', f)).href)) as {
      default?: CliCommandModule;
    };
    if (mod.default && typeof mod.default.name === 'string') overridden.add(mod.default.name);
  }
  const usage = usageByCommand(ec241bcUsage());
  const plain = ADAPTERS.filter((n) => !overridden.has(n));
  expect(plain.length).toBeGreaterThan(0);
  for (const name of plain) {
    const r = runCli([name, '--help']);
    expect(r.status, `${name}: ${r.stderr}`).toBe(0);
    expect(r.stdout, name).toBe(`${usage.get(name)}\n`);
  }
}, 300_000);
