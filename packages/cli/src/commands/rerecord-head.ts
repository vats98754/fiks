// `fiks rerecord-head` (PLAN P23): the single re-record entry point for every arm and the grader.
//
//   pnpm fiks rerecord-head --worktree <dir> --profile <json|file> --from <commit> --log <file>
//     [--recordings <a.json,b.json>] [--check P|IV|suite|traces|ci|accept] [--require-sandbox]
//     [-- <check command> ...]
//
// Step 1 runs rerecordStale on the candidate head (product behaviour: suite-detected stale
// recordings -> *.rerecorded.json, kept). Step 2 re-records every other recording the check reads
// (named with --recordings, or read during the suite run, seen through the fs-read-log preload)
// and, when the head makes upstream requests the recording never saw, writes the re-recording at
// the original path as a per-check overlay. With a command after `--`, the command runs with the
// overlay in place, the originals are restored, and its exit code is returned; without one, the
// overlay stays until `rerecord-head --restore <manifest>`. Both steps use the one rerecord() code
// path with the given profile. One RerecordLog line is appended per call.
//
// Container-runnable (round 6): every path comes from flags; under --require-sandbox nothing is
// read from the host checkout (.env is not loaded; main.ts exits 2 unless FIKS_IN_SANDBOX=1).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { HttpExchange, Recording } from '@fiks/contracts';
import type {
  CliCommandModule,
  InjectorRule,
  RerecordCheck,
  RerecordFile,
  RerecordLog,
  RerecordProfile,
  SuiteRun,
} from '@fiks/interfaces';
import { FS_READ_LOG_PRELOAD, reproHooks } from '@fiks/repro';
import { repoRelative, rerecord } from './rerecord.ts';
import { rerecordStale } from './rerecord-stale.ts';

const CHECKS: readonly RerecordCheck[] = ['P', 'IV', 'suite', 'traces', 'ci', 'accept'];

/** The product's own recording folders: the suite asserts each through expectRecordingHolds, so
 * step 1 already sees them go stale. Step 2 overlays them only when named with --recordings. */
const PRODUCT_RECORDINGS = /^test\/(fixtures|repro|traces)\//;

const INCIDENTAL =
  /^(accept|accept-.*|user-agent|sec-.*|connection|keep-alive|host|content-length|transfer-encoding|date)$/;

/** The replay request key (shop-mcp test/fiks/replay.ts): method, url, body, header names. */
export function requestKey(e: Pick<HttpExchange, 'request'>): string {
  const names = Object.keys(e.request.headers)
    .map((h) => h.toLowerCase())
    .filter((h) => !INCIDENTAL.test(h))
    .sort()
    .join(',');
  return `${e.request.method} ${e.request.url} body=${e.request.body ?? ''} headers=[${names}]`;
}

export function requestKeys(rec: Pick<Recording, 'http' | 'probe'>): string[] {
  return [...(rec.http ?? []), ...(rec.probe?.http ?? [])].map(requestKey);
}

function isRecording(x: unknown): x is Recording {
  const r = x as Partial<Recording> | null;
  return !!r && typeof r === 'object' && typeof r.tool === 'string' && Array.isArray(r.http);
}

export interface RerecordHeadOptions {
  worktree: string;
  profile: RerecordProfile;
  rule?: InjectorRule;
  fromCommit: string;
  log: string;
  check?: RerecordCheck;
  /** Extra recordings the check reads (repo-relative or absolute). */
  recordings?: string[];
  /** Run this with the overlay in place, then restore (exit code returned). */
  command?: string[];
  /** Where to write the overlay restore manifest when no command is given. */
  manifest?: string;
}

export interface RerecordHeadResult {
  log: RerecordLog & { at: string };
  /** Exit code of `command`, when one ran. */
  commandExit?: number;
  /** Restore manifest, when the overlay was left in place. */
  manifest?: string;
}

interface OverlayManifest {
  worktree: string;
  backups: { path: string; backup: string }[];
}

function gitBlob(worktree: string, commit: string, rel: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${commit}:${rel}`], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** Restores overlaid recordings from a manifest (byte copies of the originals). */
export function restoreOverlay(manifestFile: string): string[] {
  const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as OverlayManifest;
  for (const b of m.backups) writeFileSync(join(m.worktree, b.path), readFileSync(b.backup));
  rmSync(dirname(manifestFile), { recursive: true, force: true });
  return m.backups.map((b) => b.path);
}

export async function rerecordHead(opts: RerecordHeadOptions): Promise<RerecordHeadResult> {
  const wt = resolve(opts.worktree);
  const domain = opts.profile.domain;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
  // The log names commits, never moving refs.
  const fromCommit = execFileSync('git', ['rev-parse', '--verify', `${opts.fromCommit}^{commit}`], {
    cwd: wt,
    encoding: 'utf8',
  }).trim();
  const files: RerecordFile[] = [];

  // Step 1: suite-detected stale recordings -> *.rerecorded.json (product behaviour), with the
  // suite run under the fs-read-log preload so step 2 knows what the check reads.
  const scratch = mkdtempSync(join(tmpdir(), 'fiks-rerecord-head-'));
  const readLog = join(scratch, 'reads.log');
  let firstRun = true;
  const runWithReadLog = (dir: string): SuiteRun => {
    const { suite } = reproHooks(domain);
    if (!firstRun) return suite.run(dir, suite.scope);
    firstRun = false;
    const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, FIKS_FS_READ_LOG: process.env.FIKS_FS_READ_LOG };
    process.env.NODE_OPTIONS = `${saved.NODE_OPTIONS ?? ''} --require ${FS_READ_LOG_PRELOAD}`.trim();
    process.env.FIKS_FS_READ_LOG = readLog;
    try {
      return suite.run(dir, suite.scope);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const unsupported: string[] = [];
  let stale: Awaited<ReturnType<typeof rerecordStale>> = [];
  try {
    stale = await rerecordStale(wt, {
      fromCommit,
      profile: opts.profile,
      rule: opts.rule,
      domain,
      runSuite: runWithReadLog,
      onUnsupported: (f) => unsupported.push(f),
    });
  } catch (e) {
    // A refused or failed re-record (e.g. a different upstream): logged, never silently skipped.
    const why = e instanceof Error ? e.message : String(e);
    files.push({
      path: `(stale) ${why.slice(0, 300)}`,
      mode: 'stale',
      requestKeysBefore: [],
      requestKeysAfter: [],
      outcome: 'failed',
    });
  }
  const handled = new Set<string>();
  for (const r of stale) {
    const rel = repoRelative(wt, r.source);
    handled.add(rel);
    const before = gitBlob(wt, fromCommit, rel) ?? readFileSync(join(wt, rel), 'utf8');
    files.push({
      path: rel,
      mode: 'stale',
      requestKeysBefore: requestKeys(JSON.parse(before)),
      requestKeysAfter: requestKeys(JSON.parse(r.bytes)),
      outcome: 'rerecorded',
    });
  }

  // Step 2: every other recording the check reads -> overlay when the head's requests changed.
  const candidates = new Set<string>();
  const consider = (file: string, explicit: boolean) => {
    let rel: string;
    try {
      rel = repoRelative(wt, isAbsolute(file) ? file : join(wt, file));
    } catch {
      return; // outside the worktree
    }
    if (rel.startsWith('node_modules/') || rel.endsWith('.rerecorded.json') || handled.has(rel)) return;
    if (!rel.endsWith('.json') || (!explicit && PRODUCT_RECORDINGS.test(rel))) return;
    if (!existsSync(join(wt, rel))) return;
    candidates.add(rel);
  };
  for (const f of opts.recordings ?? []) consider(f, true);
  for (const f of unsupported) consider(f, true);
  if (existsSync(readLog))
    for (const f of readFileSync(readLog, 'utf8').split('\n').filter(Boolean)) consider(f, false);

  const backups: OverlayManifest['backups'] = [];
  const backupDir = join(scratch, 'originals');
  for (const rel of [...candidates].sort()) {
    const original = gitBlob(wt, fromCommit, rel) ?? readFileSync(join(wt, rel), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(original);
    } catch {
      continue;
    }
    if (!isRecording(parsed)) continue;
    const before = requestKeys(parsed);
    const entry: RerecordFile = {
      path: rel,
      mode: 'overlay',
      requestKeysBefore: before,
      requestKeysAfter: before,
      outcome: 'unchanged',
    };
    files.push(entry);
    try {
      const r = await rerecord(join(wt, rel), {
        shopDir: wt,
        overlay: true,
        source: original,
        profile: opts.profile,
        rule: opts.rule,
        domain,
      });
      const after = requestKeys(JSON.parse(r.bytes));
      entry.requestKeysAfter = after;
      const seen = new Set(before);
      if (after.some((k) => !seen.has(k))) {
        const backup = join(backupDir, `${backups.length}.json`);
        mkdirSync(backupDir, { recursive: true });
        writeFileSync(backup, readFileSync(join(wt, rel)));
        backups.push({ path: rel, backup });
        writeFileSync(join(wt, rel), r.bytes);
        entry.outcome = 'rerecorded';
      }
    } catch {
      entry.outcome = 'failed';
    }
  }

  files.sort((a, b) => (a.path === b.path ? a.mode.localeCompare(b.mode) : a.path < b.path ? -1 : 1));
  const log: RerecordLog & { at: string } = {
    profile: opts.profile,
    head,
    fromCommit,
    check: opts.check ?? 'suite',
    files,
    at: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(opts.log)), { recursive: true });
  appendFileSync(resolve(opts.log), `${JSON.stringify(log)}\n`);

  const manifestFile = opts.manifest ?? join(scratch, 'overlay.json');
  writeFileSync(manifestFile, JSON.stringify({ worktree: wt, backups } satisfies OverlayManifest));
  if (!opts.command?.length) {
    if (backups.length === 0) rmSync(scratch, { recursive: true, force: true });
    return { log, ...(backups.length ? { manifest: manifestFile } : {}) };
  }
  try {
    const [cmd, ...args] = opts.command;
    const r = spawnSync(cmd as string, args, { cwd: wt, stdio: 'inherit' });
    return { log, commandExit: r.status ?? 1 };
  } finally {
    for (const b of backups) writeFileSync(join(wt, b.path), readFileSync(b.backup));
    rmSync(scratch, { recursive: true, force: true });
  }
}

function readJsonArg(raw: string): unknown {
  const text = raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8');
  return JSON.parse(text);
}

const USAGE_LINE =
  'rerecord-head --worktree <dir> --profile <json|file> --from <commit> --log <file> [--recordings a,b] [--check P|IV|suite|traces|ci|accept] [--require-sandbox] [-- <cmd>...] | --restore <manifest>';

const command: CliCommandModule = {
  name: 'rerecord-head',
  describe: 'the one re-record entry point (P23): stale recordings + per-check overlays on a candidate head',
  async run(argv) {
    const sep = argv.indexOf('--');
    const own = sep === -1 ? argv : argv.slice(0, sep);
    const passthrough = sep === -1 ? [] : argv.slice(sep + 1);
    const { values } = parseArgs({
      args: own,
      options: {
        worktree: { type: 'string' },
        profile: { type: 'string' },
        rule: { type: 'string' },
        from: { type: 'string' },
        recordings: { type: 'string' },
        log: { type: 'string' },
        check: { type: 'string' },
        manifest: { type: 'string' },
        restore: { type: 'string' },
        'require-sandbox': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
    if (values.help) {
      console.log(`  ${USAGE_LINE}`);
      return 0;
    }
    if (values['require-sandbox'] && process.env.FIKS_IN_SANDBOX !== '1') {
      console.error(
        'sandbox required: rerecord-head --require-sandbox runs only inside the per-attempt container',
      );
      return 2;
    }
    if (values.restore) {
      const restored = restoreOverlay(values.restore);
      console.log(values.json ? JSON.stringify({ restored }) : `restored ${restored.length} file(s)`);
      return 0;
    }
    if (!values.worktree || !values.profile || !values.from || !values.log) {
      console.error(`usage: fiks ${USAGE_LINE}`);
      return 2;
    }
    const check = (values.check ?? 'suite') as RerecordCheck;
    if (!CHECKS.includes(check)) {
      console.error(`--check must be one of ${CHECKS.join(', ')}`);
      return 2;
    }
    const p = readJsonArg(values.profile) as RerecordProfile & { rule?: InjectorRule; rulePath?: string };
    if (typeof p?.domain !== 'string' || typeof p.base !== 'string') {
      console.error('--profile needs {domain, base, ruleId, ruleHash}');
      return 2;
    }
    const profile: RerecordProfile = {
      domain: p.domain,
      base: p.base,
      ruleId: p.ruleId ?? null,
      ruleHash: p.ruleHash ?? null,
    };
    const rule = (
      values.rule ? readJsonArg(values.rule) : (p.rule ?? (p.rulePath ? readJsonArg(p.rulePath) : undefined))
    ) as InjectorRule | undefined;
    const r = await rerecordHead({
      worktree: values.worktree,
      profile,
      rule,
      fromCommit: values.from,
      log: values.log,
      check,
      recordings: values.recordings?.split(',').filter(Boolean),
      command: passthrough,
      manifest: values.manifest,
    });
    const summary = r.log.files.map((f) => `${f.mode} ${f.outcome} ${f.path}`).join('\n');
    console.error(summary || 'nothing to re-record');
    if (r.manifest)
      console.error(`overlay in place; restore with: fiks rerecord-head --restore ${r.manifest}`);
    if (values.json) console.log(JSON.stringify(r));
    if (r.log.files.some((f) => f.outcome === 'failed')) return 1;
    return r.commandExit ?? 0;
  },
};

export default command;
