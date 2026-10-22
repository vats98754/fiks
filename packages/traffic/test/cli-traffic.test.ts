// `fiks traffic` end to end with stub agents on a registered fixture domain (a throwaway git repo
// tagged seed-fixture whose server is the fixture MCP server): a P18 command module, a worktree at
// --ref, identical hashes on repeated runs, dirty-tree and credential refusals.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDomain } from '@fiks/domains';
import type { Domain } from '@fiks/interfaces';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import trafficCommand, { runTrafficCommand } from '../../cli/src/commands/traffic.ts';
import type { TrafficRow } from '../src/index.ts';
import { FIXTURE, fakeVendors, tempDir, tempRepo } from './support.ts';

const STUB_MODULE = fileURLToPath(new URL('./fixtures/stub-agent.mjs', import.meta.url));

let root: string;
let repo: string;
beforeAll(() => {
  root = tempRepo();
  repo = tempRepo('seed-fixture');
  const domain = {
    id: 'traffic-fixture',
    createVendor: () => fakeVendors().create(),
    frozenClock: '2026-10-01T12:00:00.000Z',
    baseUrlEnv: 'FIXTURE_BASE_URL',
    serverCommand: (dir: string) => ({ command: process.execPath, args: [FIXTURE], cwd: dir }),
    repo: { slug: 'vats98754/none', dir: () => repo },
    seedTag: 'seed-fixture',
    tasks: [
      { id: 'q1', prompt: 'What is item x-101?', grade: () => ({ pass: true, outcome: 'x', reason: '' }) },
      { id: 'q2', prompt: 'Order two of x-102.', grade: () => ({ pass: true, outcome: 'x', reason: '' }) },
      { id: 'q3', prompt: 'Search for mugs.', grade: () => ({ pass: true, outcome: 'x', reason: '' }) },
    ],
  } as unknown as Domain;
  registerDomain(domain);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.FIKS_LLM_FORBID;
});

const quiet = () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  return { log, err };
};
const outDir = () => join(tempDir(), 'run');
const rowsOf = (out: string) =>
  readFileSync(join(out, 'args.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as TrafficRow);

describe('fiks traffic', () => {
  test('is a P18 command module: {name, describe, run(argv)}; usage errors exit 2', async () => {
    const { log, err } = quiet();
    expect(trafficCommand.name).toBe('traffic');
    expect(trafficCommand.describe).toMatch(/held-out multi-model traffic/);
    expect(await trafficCommand.run(['--help'])).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/--agents <list>/);
    expect(await runTrafficCommand([], { root })).toBe(2);
    expect(await runTrafficCommand(['--domain', 'traffic-fixture', '--agents', 'gpt'], { root })).toBe(2);
    expect(await runTrafficCommand(['--domain', 'traffic-fixture', '--trials', '0'], { root })).toBe(2);
    expect(await runTrafficCommand(['--domain', 'traffic-fixture', '--bogus'], { root })).toBe(2);
    expect(err.mock.calls.flat().join('\n')).toMatch(/--trials must be an integer >= 1/);
  });

  test('--agent-stub builtin: four agents x 3 tasks x 2 trials, identical hashes on a repeated run', async () => {
    quiet();
    const a = outDir();
    const b = outDir();
    const argv = (out: string) => [
      '--domain',
      'traffic-fixture',
      '--agent-stub',
      'builtin',
      '--trials',
      '2',
      '--out',
      out,
    ];
    expect(await runTrafficCommand(argv(a), { root })).toBe(0);
    expect(process.env.FIKS_LLM_FORBID).toBe('1');
    expect(await runTrafficCommand(argv(b), { root })).toBe(0);
    const sa = readFileSync(join(a, 'args.jsonl.sha256'), 'utf8');
    expect(readFileSync(join(b, 'args.jsonl.sha256'), 'utf8')).toBe(sa);
    const rows = rowsOf(a);
    expect(new Set(rows.map((r) => r.agent))).toEqual(new Set(['opus', 'sonnet', 'haiku', 'ollama']));
    expect(new Set(rows.map((r) => r.model))).toEqual(
      new Set([
        'stub:claude-opus-5-5',
        'stub:claude-sonnet-5-5',
        'stub:claude-haiku-5-5',
        'stub:qwen2.5:7b-instruct',
      ]),
    );
    expect(new Set(rows.map((r) => r.trial))).toEqual(new Set([1, 2]));
    const meta = JSON.parse(readFileSync(join(a, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({
      domain: 'traffic-fixture',
      agentStub: 'builtin',
      fiksDirty: false,
      server: { ref: 'seed-fixture' },
      vendor: { version: 'v1', catalog: 'original', clock: '2026-10-01T12:00:00.000Z' },
      tasks: { source: 'Domain.tasks', ids: ['q1', 'q2', 'q3'] },
    });
    expect(meta.server.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.fiksSha).toMatch(/^[0-9a-f]{40}$/);
    expect(sa.startsWith(meta.argsSha256)).toBe(true);
  });

  test('--agent-stub <module>, --agents, --tasks and --trials select the sessions', async () => {
    quiet();
    const out = outDir();
    expect(
      await runTrafficCommand(
        [
          '--domain',
          'traffic-fixture',
          '--agent-stub',
          STUB_MODULE,
          '--agents',
          'haiku',
          '--tasks',
          'q2',
          '--trials',
          '2',
          '--out',
          out,
        ],
        { root },
      ),
    ).toBe(0);
    expect(rowsOf(out).map((r) => [r.agent, r.taskId, r.trial, r.tool, r.args, r.valid])).toEqual([
      ['haiku', 'q2', 1, 'get_item', { id: 'x-101' }, true],
      ['haiku', 'q2', 2, 'get_item', { id: 'x-102' }, true],
    ]);
  });

  test('refuses a dirty fiks tree (exit 2) unless --allow-dirty, and then never writes to evidence paths', async () => {
    const { err } = quiet();
    const dirty = tempRepo();
    writeFileSync(join(dirty, 'uncommitted.ts'), 'export {};\n');
    const out = outDir();
    const base = [
      '--domain',
      'traffic-fixture',
      '--agent-stub',
      'builtin',
      '--trials',
      '1',
      '--agents',
      'opus',
    ];
    expect(await runTrafficCommand([...base, '--out', out], { root: dirty })).toBe(2);
    expect(err.mock.calls.flat().join('\n')).toMatch(/refusing to start: .* uncommitted changes/);
    expect(
      await runTrafficCommand([...base, '--out', join(dirty, 'paper/results/raw/x')], { root: dirty }),
    ).toBe(2);
    expect(
      await runTrafficCommand([...base, '--allow-dirty', '--out', join(dirty, 'paper/results/raw/x')], {
        root: dirty,
      }),
    ).toBe(2);
    expect(await runTrafficCommand([...base, '--allow-dirty', '--out', out], { root: dirty })).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).fiksDirty).toBe(true);
  });

  test('Claude agents need the OAuth token; the refusal comes before any worktree or session', async () => {
    const { err } = quiet();
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
    const out = outDir();
    expect(
      await runTrafficCommand(['--domain', 'traffic-fixture', '--agents', 'opus', '--out', out], { root }),
    ).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch(/needs a Claude credential: CLAUDE_CODE_OAUTH_TOKEN/);
  });

  test('ollama: an explicit SKIP (listed in meta) when no model is approved or it cannot run here', async () => {
    const { err } = quiet();
    const claude = (await import(STUB_MODULE)).default;
    const out = outDir();
    const argv = [
      '--domain',
      'traffic-fixture',
      '--agents',
      'haiku,ollama',
      '--trials',
      '1',
      '--tasks',
      'q1',
    ];
    expect(
      await runTrafficCommand([...argv, '--out', out], { root, claude, ollama: { model: () => null } }),
    ).toBe(0);
    expect(err.mock.calls.flat().join('\n')).toMatch(/ollama SKIP: no ollama model is approved/);
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
    expect(meta.skipped).toEqual([
      { agent: 'ollama', model: null, reason: 'no ollama model is approved (packages/llm/ollama.json)' },
    ]);
    expect(meta.agents).toEqual([{ name: 'haiku', model: 'claude-haiku-5-5', route: 'claude' }]);
    const out2 = outDir();
    const notReady = { model: () => 'm:1', readiness: async () => ({ ready: false, reason: 'server down' }) };
    expect(await runTrafficCommand([...argv, '--out', out2], { root, claude, ollama: notReady })).toBe(0);
    expect(JSON.parse(readFileSync(join(out2, 'meta.json'), 'utf8')).skipped).toEqual([
      { agent: 'ollama', model: 'm:1', reason: 'server down' },
    ]);
    // Only ollama asked for and skipped: nothing can run.
    expect(
      await runTrafficCommand(['--domain', 'traffic-fixture', '--agents', 'ollama', '--out', outDir()], {
        root,
        ollama: { model: () => null },
      }),
    ).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch(/no agent can run \(ollama skipped\)/);
    // A ready model runs on the ollama route, one session at a time.
    const out3 = outDir();
    const ready = { model: () => 'm:1', readiness: async () => ({ ready: true }), agent: claude };
    expect(await runTrafficCommand([...argv, '--out', out3], { root, claude, ollama: ready })).toBe(0);
    expect(JSON.parse(readFileSync(join(out3, 'meta.json'), 'utf8')).agents).toEqual([
      { name: 'haiku', model: 'claude-haiku-5-5', route: 'claude' },
      { name: 'ollama', model: 'm:1', route: 'ollama' },
    ]);
  });

  test('an unknown --ref fails without fetching', async () => {
    const { err } = quiet();
    expect(
      await runTrafficCommand(
        ['--domain', 'traffic-fixture', '--agent-stub', 'builtin', '--ref', 'no-such-tag', '--out', outDir()],
        { root },
      ),
    ).toBe(1);
    expect(err.mock.calls.flat().join('\n')).toMatch(/unknown ref "no-such-tag"/);
  });
});
