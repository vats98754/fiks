// Author-session isolation (PLAN 5.2 item 2): reads and writes stay inside the export (symlinks
// included), web tools are refused, Bash runs in a `--network none` container, every tool call is
// logged, and the transcript audit flags forbidden reads and sentinel strings.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_IMAGE } from '@fiks/sandbox';
import { describe, expect, test } from 'vitest';
import { buildExport, textSource } from '../src/export.ts';
import {
  auditTranscript,
  dockerBash,
  makeAuthorCanUseTool,
  runAuthorSession,
  type ToolLogEntry,
} from '../src/session.ts';
import { stubDeps } from '../src/stub.ts';

const DOCKER = 'docker';
const exportDir = () =>
  buildExport({
    kind: 'catalog',
    label: 'session-test',
    root: mkdtempSync(join(tmpdir(), 'blind-sess-')),
    files: [textSource('docs/a.md', '# a'), textSource('BRIEF.md', 'brief')],
  }).dir;
const logOf = (f: string) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ToolLogEntry);
const opts = { signal: new AbortController().signal, toolUseID: 't' } as never;

describe('permission hook', () => {
  test('reads inside the export pass; reads outside (incl. via symlink) are refused and logged as forbidden', async () => {
    const dir = exportDir();
    symlinkSync(join(homedir(), 'fiks'), join(dir, 'escape'));
    const toolLog = join(mkdtempSync(join(tmpdir(), 'blind-log-')), 'tools.jsonl');
    const can = makeAuthorCanUseTool({ exportDir: dir, tools: ['Read', 'Glob', 'Grep', 'Write'], toolLog });
    expect((await can('Read', { file_path: join(dir, 'docs/a.md') }, opts))?.behavior).toBe('allow');
    expect((await can('Read', { file_path: 'docs/a.md' }, opts))?.behavior).toBe('allow');
    expect((await can('Grep', { pattern: 'x' }, opts))?.behavior).toBe('allow');
    for (const input of [
      { file_path: join(homedir(), 'fiks', 'CLAUDE.md') },
      { file_path: '../../etc/passwd' },
      { file_path: 'escape/CLAUDE.md' },
    ])
      expect((await can('Read', input, opts))?.behavior, JSON.stringify(input)).toBe('deny');
    expect((await can('Glob', { pattern: '/Users/**/*.contracts.json' }, opts))?.behavior).toBe('deny');
    expect((await can('Write', { file_path: '/tmp/x.txt', content: 'x' }, opts))?.behavior).toBe('deny');
    expect((await can('WebFetch', { url: 'https://example.com' }, opts))?.behavior).toBe('deny');
    expect((await can('Bash', { command: 'ls' }, opts))?.behavior).toBe('deny'); // not allowed here
    const log = logOf(toolLog);
    expect(log).toHaveLength(10);
    expect(log.filter((e) => e.forbiddenRead)).toHaveLength(4);
    expect(log.every((e) => e.decision === 'allow' || e.reason)).toBe(true);
  });

  test('Bash runs in a --network none container: egress is denied and the session sees a relay', async () => {
    const dir = exportDir();
    const toolLog = join(mkdtempSync(join(tmpdir(), 'blind-log-')), 'tools.jsonl');
    const bash = dockerBash({ exportDir: dir, image: BASE_IMAGE });
    const can = makeAuthorCanUseTool({ exportDir: dir, tools: ['Bash'], toolLog, bash });
    try {
      const d = await can(
        'Bash',
        {
          command:
            "cat BRIEF.md; echo; ls /work; node -e \"require('dns').lookup('example.com',(e)=>console.log(e?'EGRESS_DENIED '+e.code:'EGRESS_OK'))\"",
        },
        opts,
      );
      expect(d?.behavior).toBe('allow');
      const cmd = String((d as unknown as { updatedInput: { command: string } }).updatedInput.command);
      expect(cmd).toMatch(/^cat '.+bash-1\.txt'; exit 0$/);
      const relay = readFileSync(/^cat '(.+)'/.exec(cmd)?.[1] as string, 'utf8');
      expect(relay).toContain('brief');
      expect(relay).toContain('BRIEF.md');
      expect(relay).toMatch(/EGRESS_DENIED (EAI_AGAIN|ENOTFOUND)/);
      const name = bash.describe().container;
      expect(
        execFileSync(DOCKER, ['inspect', '-f', '{{.HostConfig.NetworkMode}}', name], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('none');
      const [entry] = logOf(toolLog);
      expect(entry?.bash).toMatchObject({ code: 0, network: 'none', container: name, image: BASE_IMAGE });
    } finally {
      await bash.cleanup();
    }
  });
});

describe('runAuthorSession + audit', () => {
  test('transcript header: settingSources [], cwd = export, no web tools; the audit passes', async () => {
    const dir = exportDir();
    const logDir = mkdtempSync(join(tmpdir(), 'blind-logs-'));
    const deps = stubDeps(() => ({
      toolUses: [{ name: 'Read', input: { file_path: 'BRIEF.md' } }],
      text: 'ok',
    }));
    const run = await runAuthorSession({
      kind: 'catalog',
      label: 's1',
      exportDir: dir,
      prompt: 'read the brief',
      model: 'claude-opus-5-5',
      tools: ['Read', 'Glob', 'Grep'],
      budget: { maxTurns: 3, maxBudgetUsd: 1 },
      logDir,
      deps,
    });
    expect(run.session.ok).toBe(true);
    const lines = readFileSync(run.transcriptPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      type: 'fiks_session_header',
      cwd: realpathSync(dir),
      settingSources: [],
      webTools: 'excluded',
      disallowedTools: ['WebFetch', 'WebSearch'],
    });
    expect(lines.at(-1)).toMatchObject({ type: 'blind_sandbox', exportDir: realpathSync(dir), bash: null });
    expect(run.audit).toMatchObject({
      ok: true,
      settingSourcesEmpty: true,
      cwdIsExport: true,
      webToolsExcluded: true,
    });
    expect(deps.calls[0]?.cwd).toBe(realpathSync(dir));
  });

  test('a forbidden read or a sentinel string fails the audit', async () => {
    const dir = exportDir();
    const logDir = mkdtempSync(join(tmpdir(), 'blind-logs-'));
    const deps = stubDeps(() => ({
      toolUses: [{ name: 'Read', input: { file_path: join(homedir(), 'fiks', 'CLAUDE.md') } }],
      text: 'Fiks — self-healing tools for AI agents',
    }));
    const run = await runAuthorSession({
      kind: 'catalog',
      label: 's2',
      exportDir: dir,
      prompt: 'p',
      model: 'm',
      tools: ['Read'],
      budget: { maxTurns: 3, maxBudgetUsd: 1 },
      logDir,
      deps,
    });
    expect(run.audit.ok).toBe(false);
    expect(run.audit.forbiddenReads.length).toBeGreaterThanOrEqual(1);
    expect(run.audit.sentinelHits).toEqual(['Fiks — self-healing tools for AI agents']);
    // A transcript written elsewhere with a different cwd fails the cwd check.
    const other = join(mkdtempSync(join(tmpdir(), 'blind-t-')), 't.jsonl');
    mkdirSync(join(other, '..'), { recursive: true });
    writeFileSync(
      other,
      `${JSON.stringify({ type: 'fiks_session_header', cwd: '/', settingSources: [], webTools: 'excluded', tools: [], disallowedTools: ['WebFetch', 'WebSearch'] })}\n`,
    );
    expect(auditTranscript(other, dir).cwdIsExport).toBe(false);
  });
});
