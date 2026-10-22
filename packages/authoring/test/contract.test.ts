// Contract authoring with a stub llm (round 7; PLAN 8.1 A0(b), 5.1, 6.1 B-LLMC): one session per
// contract, cwd = the contract-author export, settingSources: []; the export holds docs/** + exactly
// 30 calls (llm: tool descriptions + 20 S-dev records); the output is validated (schema + VOCAB's
// evaluator on every call) and written with an AUTHORING log under --out-root; an invalid output
// exits non-zero and writes nothing; the repo's contracts dir is untouched.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, findContract } from '@fiks/contracts';
import { describe, expect, test } from 'vitest';
import { contractFileErrors } from '../src/contract-schema.ts';
import { type ExportManifest, sha256 } from '../src/export.ts';
import type { ToolLogEntry } from '../src/session.ts';
import { fiks, ROOT, STUBS } from './support/cli.ts';

const C = 'packages/contracts/contracts';

function run(args: string[], stub = 'contract-author.ts') {
  const out = mkdtempSync(join(tmpdir(), 'blind-ca-'));
  const r = fiks([
    'author',
    '--kind',
    'contract',
    ...args,
    '--out-root',
    out,
    '--llm-stub',
    join(STUBS, stub),
  ]);
  const exportDir = /^export: (\S+) \(manifest (\S+)\)$/m.exec(r.out);
  const transcript = /^transcript: (\S+)$/m.exec(r.out)?.[1];
  return { ...r, outRoot: out, exportDir: exportDir?.[1], manifest: exportDir?.[2], transcript };
}

interface Meta {
  seed: number | null;
  protocol: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  export: { manifestSha256: string };
  transcript: { sha256: string };
  toolLog: { path: string };
  contract: { sha256: string };
  audit: { ok: boolean; forbiddenReads: unknown[]; sentinelHits: unknown[]; bash: unknown };
  validation: {
    schema: string;
    evaluator: {
      calls: number;
      evaluatorErrors: number;
      violations: number;
      replayMismatches: number;
      verdicts: Record<string, number>;
    };
  };
}

function authoringJson(file: string): Meta {
  const md = readFileSync(file, 'utf8');
  return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)?.[1] as string);
}

describe.each([
  ['tracker', 'tracker', 'tracker-mcp.contracts.json', 'AUTHORING-tracker.md', 'tracker-mcp'],
  ['shop', 'shop-blind', 'shop-blind.contracts.json', 'AUTHORING-shop-blind.md', 'shop-mcp'],
])('--domain %s --protocol %s', (domain, protocol, contractName, logName, server) => {
  const r = run(['--domain', domain, '--protocol', protocol]);

  test('exits 0 and writes the contract and its AUTHORING log at the reserved paths under --out-root', () => {
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(r.outRoot, C, contractName))).toBe(true);
    expect(existsSync(join(r.outRoot, C, logName))).toBe(true);
  });

  test('one session; its transcript header shows cwd = the contract-author export and settingSources: []', () => {
    const lines = readFileSync(r.transcript as string, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const headers = lines.filter((l) => l.type === 'fiks_session_header');
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({
      cwd: realpathSync(r.exportDir as string),
      settingSources: [],
      webTools: 'excluded',
    });
    expect(headers[0]?.tools).not.toContain('WebFetch');
    expect(headers[0]?.disallowedTools).toEqual(['WebFetch', 'WebSearch']);
  });

  test('the export holds docs/** and exactly 30 calls/ files recorded on the original catalog', () => {
    const m = JSON.parse(readFileSync(r.manifest as string, 'utf8')) as ExportManifest;
    const files = m.files.map((f) => f.path);
    expect(m.kind).toBe('contract-author');
    expect(files.filter((f) => f.startsWith('calls/'))).toHaveLength(30);
    expect(files.filter((f) => !f.startsWith('calls/')).every((f) => f.startsWith('docs/'))).toBe(true);
    expect(files.filter((f) => f.startsWith('docs/')).length).toBe(2);
  });

  test("the contract validates and VOCAB's evaluator runs on all 30 calls without an evaluator error", () => {
    const text = readFileSync(join(r.outRoot, C, contractName), 'utf8');
    const file = JSON.parse(text);
    expect(contractFileErrors(file, { server })).toEqual([]);
    let n = 0;
    for (const f of readdirCalls(r.exportDir as string)) {
      const c = JSON.parse(readFileSync(f, 'utf8'));
      expect(() =>
        evaluate(findContract(file, c.tool), {
          args: c.args,
          result: c.result,
          now: new Date('2026-10-01T12:00:00.000Z'),
        }),
      ).not.toThrow();
      n++;
    }
    expect(n).toBe(30);
    const meta = authoringJson(join(r.outRoot, C, logName));
    expect(meta.validation.schema).toBe('valid');
    expect(meta.validation.evaluator).toMatchObject({ calls: 30, evaluatorErrors: 0 });
  });

  test('the AUTHORING log records model, export manifest sha256, transcript sha256 and the validation result', () => {
    const md = readFileSync(join(r.outRoot, C, logName), 'utf8');
    const meta = authoringJson(join(r.outRoot, C, logName));
    expect(md).toContain('- Model: claude-opus-5-5');
    expect(meta.export.manifestSha256).toBe(sha256(readFileSync(r.manifest as string)));
    expect(md).toContain(`Export manifest sha256: ${meta.export.manifestSha256}`);
    expect(meta.transcript.sha256).toBe(sha256(readFileSync(r.transcript as string)));
    expect(md).toContain(`Transcript sha256: ${meta.transcript.sha256}`);
    expect(meta.sessionId).toMatch(/^stub-/);
    expect(meta.startedAt <= meta.endedAt).toBe(true);
    expect(meta.contract.sha256).toBe(sha256(readFileSync(join(r.outRoot, C, contractName))));
    expect(meta.audit).toMatchObject({ ok: true, forbiddenReads: [], sentinelHits: [] });
  });

  test("the session's Bash ran in a --network none container (egress denied)", () => {
    const meta = authoringJson(join(r.outRoot, C, logName));
    const log = readFileSync(meta.toolLog.path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ToolLogEntry);
    const bash = log.filter((e) => e.tool === 'Bash');
    expect(bash).toHaveLength(1);
    expect(bash[0]).toMatchObject({ decision: 'allow', bash: { network: 'none', code: 0 } });
    expect(bash[0]?.bash?.outputHead).toMatch(/^30\n/);
    expect(bash[0]?.bash?.outputHead).toMatch(/EGRESS_DENIED/);
    expect(meta.audit.bash).toMatchObject({ backend: 'docker', network: 'none' });
  });
});

function readdirCalls(dir: string): string[] {
  return execFileSync('sh', ['-c', `ls "${dir}"/calls/*.json`], { encoding: 'utf8' })
    .trim()
    .split('\n');
}

describe.each(['tracker', 'shop'])('--domain %s --protocol llm --seed 2', (domain) => {
  test('writes llm-authored/<domain>-seed2.contracts.json from tool descriptions + 20 S-dev records', () => {
    const r = run(['--domain', domain, '--protocol', 'llm', '--seed', '2', '--no-sandbox']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(r.outRoot, C, `llm-authored/${domain}-seed2.contracts.json`))).toBe(true);
    expect(existsSync(join(r.outRoot, C, `llm-authored/AUTHORING-${domain}-seed2.md`))).toBe(true);
    const m = JSON.parse(readFileSync(r.manifest as string, 'utf8')) as ExportManifest;
    expect(m.kind).toBe('contract-llm');
    expect(m.files.map((f) => f.path).filter((f) => !f.startsWith('calls/'))).toEqual(['tools/tools.json']);
    expect(m.files.filter((f) => f.path.startsWith('calls/'))).toHaveLength(20);
    const meta = authoringJson(join(r.outRoot, C, `llm-authored/AUTHORING-${domain}-seed2.md`));
    expect(meta).toMatchObject({
      seed: 2,
      protocol: 'llm',
      validation: { evaluator: { calls: 20, evaluatorErrors: 0 } },
    });
  });
});

describe('read-after-write evaluation', () => {
  test('the shop contracts (with readAfterWrite) verify on the 30 shop calls: the probe is replayed', () => {
    const r = run(['--domain', 'shop', '--no-sandbox'], 'contract-shop-real.ts');
    expect(r.code, r.out).toBe(0);
    const meta = authoringJson(join(r.outRoot, C, 'AUTHORING-shop-blind.md'));
    expect(meta.validation.evaluator).toMatchObject({
      calls: 30,
      evaluatorErrors: 0,
      violations: 0,
      replayMismatches: 0,
    });
    expect(meta.validation.evaluator.verdicts.verified).toBeGreaterThan(0);
  });
});

describe('an invalid stub output', () => {
  test('exits non-zero and writes no contract file; the repo contracts dir is untouched', () => {
    const r = run(['--domain', 'tracker', '--no-sandbox'], 'contract-invalid.ts');
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/unknown kind "telepathy"/);
    expect(existsSync(join(r.outRoot, C, 'tracker-mcp.contracts.json'))).toBe(false);
    expect(existsSync(join(r.outRoot, C, 'AUTHORING-tracker.md'))).toBe(false);
    expect(execFileSync('git', ['status', '--porcelain', C], { cwd: ROOT, encoding: 'utf8' })).toBe('');
  });
});
