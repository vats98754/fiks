import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { lockPaths, tryAcquire } from '../src/live-lock.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const CLI = fileURLToPath(new URL('../src/live-lock.ts', import.meta.url));

function runCli(home: string, args: string[]) {
  const child = spawn(TSX, [CLI, ...args], {
    env: { PATH: process.env.PATH ?? '', HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += String(d);
  });
  child.stderr.on('data', (d) => {
    out += String(d);
  });
  const done = new Promise<{ code: number | null; out: string; endedAt: number }>((resolve) =>
    child.on('exit', (code) => resolve({ code, out, endedAt: Date.now() })),
  );
  return { child, done, out: () => out };
}

const holder = { pid: process.pid, host: hostname(), label: 't', cmd: ['x'], cwd: '/', timeoutMs: 60_000 };

describe('live-lock', () => {
  test('admits one holder at a time', () => {
    const p = lockPaths(mkdtempSync(join(tmpdir(), 'fiks-ll-')));
    const a = tryAcquire(p, holder);
    expect(a.acquired).toBe(true);
    const b = tryAcquire(p, { ...holder, label: 'second' });
    expect(b.acquired).toBe(false);
    if (!b.acquired) {
      expect(b.holder?.label).toBe('t');
      expect(b.staleness.stale).toBe(false);
    }
    if (a.acquired) a.release();
    expect(existsSync(p.lockDir)).toBe(false);
    const c = tryAcquire(p, holder);
    expect(c.acquired).toBe(true);
    if (c.acquired) c.release();
  });

  test('a second --run waits for the first and they never overlap', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fiks-ll-home-'));
    const marker = join(home, 'marks.txt');
    const node = process.execPath;
    const job = (name: string, ms: number) => [
      '--run',
      '--poll-ms',
      '100',
      '--label',
      name,
      '--',
      node,
      '-e',
      `const fs=require('fs');fs.appendFileSync(${JSON.stringify(marker)},'${name}-start '+Date.now()+'\\n');setTimeout(()=>fs.appendFileSync(${JSON.stringify(marker)},'${name}-end '+Date.now()+'\\n'),${ms})`,
    ];
    const first = runCli(home, job('A', 6000));
    // wait until A holds the lock
    const p = lockPaths(join(home, '.fiks'));
    for (let i = 0; i < 100 && !existsSync(p.holderFile); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(p.holderFile)).toBe(true);
    const second = runCli(home, job('B', 10));
    const [a, b] = await Promise.all([first.done, second.done]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(b.out).toMatch(/waiting: held by pid \d+ \(A\)/);
    const marks = readFileSync(marker, 'utf8').trim().split('\n');
    expect(marks.map((m) => m.split(' ')[0])).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
    const log = readFileSync(p.logFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { event: string; holder: { label: string }; durationMs?: number });
    expect(log.map((l) => `${l.event}:${l.holder.label}`)).toEqual([
      'acquired:A',
      'released:A',
      'acquired:B',
      'released:B',
    ]);
    expect(log[1]?.durationMs).toBeGreaterThanOrEqual(5500);
    expect(existsSync(p.lockDir)).toBe(false);
  }, 30_000);

  test('a stale lock (older than its recorded timeout) is reported, not broken', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fiks-ll-home-'));
    const p = lockPaths(join(home, '.fiks'));
    mkdirSync(p.lockDir, { recursive: true });
    const stale = {
      ...holder,
      label: 'crashed-holder',
      startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      timeoutMs: 3_600_000,
    };
    writeFileSync(p.holderFile, JSON.stringify(stale));
    const r = await runCli(home, ['--run', '--', process.execPath, '-e', 'process.exit(0)']).done;
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/STALE lock/);
    expect(r.out).toMatch(/longer than its recorded timeout/);
    expect(r.out).toMatch(/not breaking it/);
    expect(JSON.parse(readFileSync(p.holderFile, 'utf8')).label).toBe('crashed-holder');
    expect(readFileSync(p.logFile, 'utf8')).toMatch(/stale_reported/);

    // --break removes it explicitly (and logs it)
    const br = await runCli(home, ['--break']).done;
    expect(br.code).toBe(0);
    expect(existsSync(p.lockDir)).toBe(false);
    expect(readFileSync(p.logFile, 'utf8')).toMatch(/"event":"broken"/);
  }, 20_000);

  test('--break refuses a fresh lock; --run refuses while run.active exists', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fiks-ll-home-'));
    const p = lockPaths(join(home, '.fiks'));
    mkdirSync(p.lockDir, { recursive: true });
    writeFileSync(p.holderFile, JSON.stringify({ ...holder, startedAt: new Date().toISOString() }));
    const br = await runCli(home, ['--break']).done;
    expect(br.code).toBe(1);
    expect(existsSync(p.lockDir)).toBe(true);

    const home2 = mkdtempSync(join(tmpdir(), 'fiks-ll-home-'));
    const p2 = lockPaths(join(home2, '.fiks'));
    mkdirSync(p2.root, { recursive: true });
    writeFileSync(p2.runActive, '');
    const r = await runCli(home2, ['--run', '--', process.execPath, '-e', 'process.exit(0)']).done;
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/run\.active exists/);
    expect(existsSync(p2.lockDir)).toBe(false);
  }, 20_000);
});
