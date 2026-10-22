// The CLI loader (PLAN P18): bootstraps first, default-export command modules win over legacy
// adapters, files without a default export are ignored, and main.ts has no command switch.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { CLI_SRC, privateCli, runCli } from './support/cli.ts';

// Temporary modules go into a private copy of the CLI, never the real packages/cli/src, which CLI
// subprocesses of other test files load in parallel.
const cli = privateCli();
const planted: string[] = [];
function plant(rel: string, src: string) {
  const file = join(cli.src, rel);
  planted.push(file);
  writeFileSync(file, src);
}
function removePlanted() {
  for (const f of planted.splice(0)) rmSync(f, { force: true });
}
afterAll(() => {
  removePlanted();
  cli.cleanup();
});

test('main.ts has no command switch', () => {
  const main = readFileSync(join(CLI_SRC, 'main.ts'), 'utf8');
  expect(main.match(/case '/g)).toBeNull();
  expect(main).not.toMatch(/switch\s*\(/);
});

test('bootstrap modules, default-export commands, legacy fallback, no-default files', {
  timeout: 120_000,
}, async () => {
  try {
    // (c) a bootstrap module sets a global the dispatched command observes.
    plant('bootstrap/zz-boot.ts', "(globalThis as Record<string, unknown>).__fiksZzBoot = 'booted';\n");
    // (a) a new command module.
    plant(
      'commands/zz-probe.ts',
      `export default {
  name: 'zz-probe',
  describe: 'loader probe',
  run(argv: string[]) {
  console.log(JSON.stringify({ probe: argv, boot: (globalThis as Record<string, unknown>).__fiksZzBoot ?? null }));
  return 7;
  },
};
`,
    );
    // (b) a default export named like a legacy command replaces the legacy adapter.
    plant(
      'commands/zz-dup.ts',
      `export default { name: 'confirm', describe: 'override', run() { console.log('zz-dup confirm'); return 0; } };\n`,
    );
    // (d) no default export: ignored, even though it looks like a command.
    plant(
      'commands/zz-nodefault.ts',
      `export const name = 'zz-nodefault';\nexport function run() { console.log('should not run'); }\n`,
    );

    const a = runCli(['zz-probe', 'x', '--y'], { src: cli.src });
    expect(a.status, a.stderr).toBe(7);
    expect(JSON.parse(a.stdout.trim())).toEqual({ probe: ['x', '--y'], boot: 'booted' });

    // The real CLI never sees the planted modules (other test files run it in parallel).
    const real = runCli(['zz-probe']);
    expect(real.status).toBe(1);
    expect(real.stderr).toMatch(/^usage: fiks <command>/);

    const b = runCli(['confirm'], { src: cli.src });
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout.trim()).toBe('zz-dup confirm');

    const d = runCli(['zz-nodefault'], { src: cli.src });
    expect(d.status).toBe(1);
    expect(d.stdout).not.toContain('should not run');
    expect(d.stderr).toMatch(/^usage: fiks <command>/);
  } finally {
    removePlanted();
  }
  // Every temporary file is gone, and confirm is the legacy adapter again.
  for (const f of [
    'bootstrap/zz-boot.ts',
    'commands/zz-probe.ts',
    'commands/zz-dup.ts',
    'commands/zz-nodefault.ts',
  ]) {
    expect(() => readFileSync(join(cli.src, f))).toThrow();
    expect(() => readFileSync(join(CLI_SRC, f))).toThrow();
  }
  const help = runCli(['confirm', '--help'], { src: cli.src });
  expect(help.stdout).toMatch(/^ {2}confirm {2,}after a human merge/);
});
