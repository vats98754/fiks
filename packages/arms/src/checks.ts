// The checks every arm runs on a candidate head, all inside the per-attempt container (PLAN 3.0
// "Re-record parity", P1, P21, P23):
//
//  - before every replay-based check, `fiks rerecord-head --require-sandbox` (through execFiks)
//    with the drift's profile: stale suite recordings -> *.rerecorded.json, and a per-check
//    overlay of `.alerts/<id>.json` when the head changes its requests;
//  - suite gate (L1 family): typecheck, lint and the repo suite (incl. the agent's tests, the
//    contract suite and stored traces) through SBX runPreGate, with the overlay in place;
//  - IV (fiks-iv, P21): `rerecord-head --check IV -- fiks-iv ...`, so fiks-iv evaluates the
//    overlay re-recording of the trace (never a file the agent edited). L1/L1p run it as a pre-PR
//    check through SBX runPreGate; COMP runs it as a ciLocal extra check (post-PR);
//  - local CI: SBX ciLocal (the repo's ci.yml mirrored in the image), with the overlay in place.
//
// Every rerecord-head call starts from the same clean candidate tree (the stale re-recordings of
// the previous call are removed once its check is done), so each call's RerecordLog line lists the
// same files and request keys: the lines of L1, COMP and a direct call agree on the same head.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ExecBackend,
  ExecResult,
  InjectorRule,
  RerecordCheck,
  RerecordLog,
  RerecordProfile,
} from '@fiks/interfaces';
import { type CiResult, ciLocal, FIKS_TSX, RUN_SHELL, runPreGate, TOOLS_DIR } from '@fiks/sandbox';
import type { VitestJson } from './fcheck.ts';
import type { ArmSandbox } from './sandbox.ts';
import { CONTAINER_SCRATCH } from './sandbox.ts';

/** fiks-iv inside the fiks-tools tree. */
export const IV_CLI_IN_TOOLS = `${TOOLS_DIR}/packages/arms/src/iv-cli.ts`;
/** Where rerecord-head appends its RerecordLog inside the container (copied out after each call). */
const CONTAINER_LOG = `${CONTAINER_SCRATCH}/rerecord.jsonl`;

export interface CheckEnvOptions {
  sandbox: ArmSandbox;
  domain: string;
  profile: RerecordProfile;
  rule?: InjectorRule;
  /** The base commit (`--from`): recordings are judged against it. */
  fromCommit: string;
  /** `.alerts/<id>.json` (repo-relative). */
  alertRel?: string;
  /**
   * The frozen trace's bytes. Arms that show the agent no trace file (L1p) still validate the
   * issue on it: the copy is placed at `alertRel` only for the duration of the IV check.
   */
  traceBytes?: Buffer;
  /** True when the agent has `.alerts/<id>.json` (trace evidence); it is then overlaid for every check. */
  alertVisible: boolean;
  /** Frozen contract file content (staged into the container for fiks-iv). */
  contracts?: string;
  /** IV sidecar content (staged; never in the worktree). */
  sidecar?: string;
  runKey?: string;
  /** Host JSONL that collects this attempt's RerecordLog lines. */
  rerecordLog: string;
  /** Host file for the COMP-plain workflow (the repo's ci.yml running only the server's own tests). */
  plainWorkflowFile?: string;
  /** Per-command timeout inside the container. */
  timeoutMs?: number;
}

export interface RerecordResult {
  ok: boolean;
  code: number;
  line?: RerecordLog & { at?: string };
  manifest?: string;
  output: string;
}

export interface IvRun {
  pass: boolean;
  code: number;
  output: string;
  line?: RerecordLog & { at?: string };
}

export interface GateRun {
  green: boolean;
  log: string;
  rerecord: RerecordResult;
  ci?: CiResult;
}

export interface FCheckRun {
  rerecordOk: boolean;
  rerecordOutput: string;
  line?: RerecordLog & { at?: string };
  /** One entry per run: vitest's JSON report and its console output. */
  runs: { json?: VitestJson; output: string }[];
  /** Repo-relative recording files the test read (fs-read log). */
  recordingsRead: string[];
}

/** The fs-read-log preload inside the fiks-tools tree. */
const FS_READ_LOG_IN_TOOLS = `${TOOLS_DIR}/packages/repro/src/fs-read-log.cjs`;

/** The sentinel a ciLocal/runPreGate extra check runs; the checks backend routes it to fiks-iv. */
export const ivSentinel = (alertRel: string) => `fiks-iv --trace ${alertRel}`;

const out = (r: ExecResult) => `${r.stdout}${r.stdout && r.stderr ? '\n' : ''}${r.stderr}`;

export class ArmChecks {
  private staged?: Promise<{ contracts?: string; sidecar?: string; rule?: string }>;
  constructor(readonly o: CheckEnvOptions) {}

  private get sb() {
    return this.o.sandbox;
  }

  private stageInputs() {
    this.staged ??= (async () => ({
      contracts:
        this.o.contracts === undefined ? undefined : await this.sb.stage('contracts.json', this.o.contracts),
      sidecar:
        this.o.sidecar === undefined ? undefined : await this.sb.stage('iv-sidecar.json', this.o.sidecar),
      rule:
        this.o.rule === undefined ? undefined : await this.sb.stage('rule.json', JSON.stringify(this.o.rule)),
    }))();
    return this.staged;
  }

  private async rerecordArgv(check: RerecordCheck, recordings: string[]): Promise<string[]> {
    const { rule } = await this.stageInputs();
    return [
      'rerecord-head',
      '--require-sandbox',
      '--worktree',
      this.sb.workdir,
      '--profile',
      JSON.stringify(this.o.profile),
      ...(rule ? ['--rule', rule] : []),
      '--from',
      this.o.fromCommit,
      '--log',
      CONTAINER_LOG,
      '--check',
      check,
      ...(recordings.length ? ['--recordings', recordings.join(',')] : []),
    ];
  }

  /** Copies the line the last rerecord-head call appended into the host log. */
  private async collectLine(): Promise<(RerecordLog & { at?: string }) | undefined> {
    const r = await this.sb.exec('sh', [
      '-c',
      `tail -n 1 ${CONTAINER_LOG} 2>/dev/null; : > ${CONTAINER_LOG}`,
    ]);
    const text = r.stdout.trim();
    if (!text) return undefined;
    mkdirSync(dirname(this.o.rerecordLog), { recursive: true });
    appendFileSync(this.o.rerecordLog, `${text}\n`);
    try {
      return JSON.parse(text) as RerecordLog & { at?: string };
    } catch {
      return undefined;
    }
  }

  private recordings(): string[] {
    return this.o.alertVisible && this.o.alertRel ? [this.o.alertRel] : [];
  }

  /** rerecord-head without a command: stale re-recordings written, overlay left in place. */
  async rerecord(check: RerecordCheck): Promise<RerecordResult> {
    const argv = [...(await this.rerecordArgv(check, this.recordings())), '--json'];
    const r = await this.sb.fiks(argv, { timeoutMs: this.o.timeoutMs });
    const line = await this.collectLine();
    let manifest: string | undefined;
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as { manifest?: string };
      manifest = j.manifest;
    } catch {
      // No JSON: rerecord-head failed before it finished (logged below).
    }
    return { ok: r.code === 0, code: r.code, line, manifest, output: out(r) };
  }

  async restore(manifest: string | undefined): Promise<void> {
    if (!manifest) return;
    const r = await this.sb.fiks(['rerecord-head', '--require-sandbox', '--restore', manifest]);
    if (r.code !== 0) throw new Error(`rerecord-head --restore failed: ${out(r)}`);
  }

  /**
   * Removes the `*.rerecorded.json` files a rerecord-head call wrote (product behaviour keeps
   * them; here every check starts from the same candidate tree). Tracked files are never touched.
   */
  cleanStale(line: RerecordLog | undefined): void {
    for (const f of line?.files ?? []) {
      if (f.mode !== 'stale' || f.outcome !== 'rerecorded') continue;
      const rel = f.path.replace(/\.json$/, '.rerecorded.json');
      if (rel.includes('..') || !rel.startsWith('test/')) continue;
      const tracked =
        spawnSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: this.sb.worktree, stdio: 'ignore' })
          .status === 0;
      if (!tracked) rmSync(join(this.sb.worktree, rel), { force: true });
    }
  }

  /** The fiks-iv command line (inside the container), run behind `rerecord-head --check IV --`. */
  async ivCommand(): Promise<string[]> {
    if (!this.o.alertRel) throw new Error('IV needs the frozen trace');
    const { contracts, sidecar } = await this.stageInputs();
    return [
      FIKS_TSX,
      IV_CLI_IN_TOOLS,
      '--trace',
      `${this.sb.workdir}/${this.o.alertRel}`,
      '--head',
      this.sb.workdir,
      '--domain',
      this.o.domain,
      ...(contracts ? ['--contracts', contracts] : []),
      ...(sidecar ? ['--properties', sidecar] : []),
      ...(this.o.runKey ? ['--run-key', this.o.runKey] : []),
    ];
  }

  /** IV on the current head: `rerecord-head --check IV --recordings <alert> -- fiks-iv ...`. */
  async iv(): Promise<IvRun> {
    if (!this.o.alertRel) throw new Error('IV needs the frozen trace');
    const placed = !this.o.alertVisible;
    const file = join(this.sb.worktree, this.o.alertRel);
    if (placed) {
      if (!this.o.traceBytes) throw new Error('IV needs the frozen trace bytes');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, this.o.traceBytes);
    }
    try {
      const argv = [...(await this.rerecordArgv('IV', [this.o.alertRel])), '--', ...(await this.ivCommand())];
      const r = await this.sb.fiks(argv, { timeoutMs: this.o.timeoutMs });
      const line = await this.collectLine();
      this.cleanStale(line);
      const text = out(r);
      return { pass: r.code === 0 && /^IV PASS/m.test(r.stdout), code: r.code, output: text, line };
    } finally {
      if (placed) rmSync(file, { force: true });
    }
  }

  /**
   * A backend for SBX runPreGate/ciLocal: commands go to the container, except the IV sentinel,
   * which runs `iv()` (with `before` first, e.g. to take a CI overlay down so IV re-records from
   * the same clean tree as every other call).
   */
  private checksBackend(before?: () => Promise<void>): ExecBackend & { iv?: IvRun } {
    const sentinel = this.o.alertRel ? ivSentinel(this.o.alertRel) : undefined;
    const self: ExecBackend & { iv?: IvRun } = {
      exec: async (cmd, args, opts) => {
        if (sentinel && cmd === 'bash' && args.at(-1) === sentinel && args.length === RUN_SHELL.length + 1) {
          await before?.();
          const r = await this.iv();
          self.iv = r;
          return { code: r.pass ? 0 : 1, stdout: r.output, stderr: '' };
        }
        return this.sb.exec(cmd, args, opts);
      },
      cleanup: async () => {},
    };
    return self;
  }

  /** L1 family, pre-PR: typecheck, lint and the repo suite with the overlay in place. */
  async suiteGate(): Promise<GateRun> {
    const rr = await this.rerecord('suite');
    try {
      const gate = await runPreGate(
        this.sb.worktree,
        'per-attempt-container',
        [
          { name: 'typecheck', run: 'pnpm typecheck' },
          { name: 'lint', run: 'pnpm lint' },
          { name: 'suite (repo tests, contract suite, stored traces)', run: 'pnpm test' },
        ],
        { backend: this.checksBackend() },
      );
      return { green: rr.ok && gate.green, log: `${rerecordNote(rr)}${gate.log}`, rerecord: rr, ci: gate };
    } finally {
      await this.restore(rr.manifest);
      this.cleanStale(rr.line);
    }
  }

  /** L1/L1p, pre-PR: IV through SBX runPreGate. */
  async ivGate(): Promise<{ green: boolean; log: string; iv?: IvRun }> {
    if (!this.o.alertRel) throw new Error('IV needs the frozen trace');
    const backend = this.checksBackend();
    const gate = await runPreGate(
      this.sb.worktree,
      'per-attempt-container',
      [{ name: 'issue validation (fiks-iv)', run: ivSentinel(this.o.alertRel) }],
      { backend },
    );
    return { green: gate.green, log: gate.log, iv: backend.iv };
  }

  /**
   * Local CI (SBX ciLocal) with the overlay in place; with `iv`, fiks-iv is an extra check (COMP,
   * post-PR). `plain`: the COMP-plain workflow (the server's own tests only).
   */
  async ci(opts: { iv: boolean; plain?: boolean }): Promise<GateRun & { iv?: IvRun }> {
    if (opts.iv && !this.o.alertRel) throw new Error('IV needs the frozen trace');
    const rr = await this.rerecord('ci');
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await this.restore(rr.manifest);
      this.cleanStale(rr.line);
    };
    try {
      const backend = this.checksBackend(release);
      const workflow = opts.plain ? this.plainWorkflow() : undefined;
      const ci = await ciLocal(
        this.sb.worktree,
        'per-attempt-container',
        opts.iv && this.o.alertRel
          ? [{ name: 'issue validation (fiks-iv)', run: ivSentinel(this.o.alertRel) }]
          : [],
        { backend, ...(workflow ? { workflow } : {}) },
      );
      return {
        green: rr.ok && ci.green,
        log: `${rerecordNote(rr)}${ci.log}`,
        rerecord: rr,
        ci,
        iv: backend.iv,
      };
    } finally {
      await release();
    }
  }

  /**
   * REPRO-AGENT's F check (PLAN 5.5): the test file `rel` runs `runs` times on base inside the
   * container, behind `rerecord-head --check suite` (P23 parity), each run under the fs-read-log
   * preload so the recordings it loads are known.
   */
  async fCheck(rel: string, runs: number): Promise<FCheckRun> {
    if (!/^test\/[\w./-]+\.ts$/.test(rel) || rel.includes('..'))
      throw new Error(`F check: bad test path ${rel}`);
    const S = CONTAINER_SCRATCH;
    const script = [
      'cd "$1"',
      `rm -f ${S}/f-*.json ${S}/f-*.out ${S}/f-reads.log`,
      `for i in $(seq 1 ${runs}); do`,
      `  NODE_OPTIONS="--require ${FS_READ_LOG_IN_TOOLS}" FIKS_FS_READ_LOG=${S}/f-reads.log node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile.json=${S}/f-$i.json --testTimeout=60000 "$2" > ${S}/f-$i.out 2>&1`,
      'done',
      'exit 0',
    ].join('\n');
    const argv = [
      ...(await this.rerecordArgv('suite', this.recordings())),
      '--',
      'bash',
      '-c',
      script,
      'fcheck',
      this.sb.workdir,
      rel,
    ];
    const r = await this.sb.fiks(argv, { timeoutMs: this.o.timeoutMs });
    const line = await this.collectLine();
    this.cleanStale(line);
    const results: { json?: VitestJson; output: string }[] = [];
    for (let i = 1; i <= runs; i++) {
      const j = await this.sb.exec('cat', [`${S}/f-${i}.json`]);
      const o = await this.sb.exec('cat', [`${S}/f-${i}.out`]);
      let json: VitestJson | undefined;
      try {
        json = j.code === 0 ? (JSON.parse(j.stdout) as VitestJson) : undefined;
      } catch {
        json = undefined;
      }
      results.push({ json, output: o.stdout });
    }
    const reads = await this.sb.exec('cat', [`${S}/f-reads.log`]);
    const prefix = `${this.sb.workdir}/`;
    const recordingsRead = [
      ...new Set(
        reads.stdout
          .split('\n')
          .filter((p) => p.startsWith(prefix) && p.endsWith('.json'))
          .map((p) => p.slice(prefix.length))
          .filter(
            (p) => !/(^|\/)node_modules\//.test(p) && !/(^|\/)(package|tsconfig[\w.-]*|biome)\.json$/.test(p),
          )
          .filter((p) => !/\.contracts\.json$/.test(p)),
      ),
    ].sort();
    return { rerecordOk: r.code === 0, rerecordOutput: out(r), line, runs: results, recordingsRead };
  }

  /** The COMP-plain workflow, relative to the worktree (it lives outside it, in the attempt dir). */
  private plainWorkflow(): string {
    const f = this.o.plainWorkflowFile;
    if (!f || !existsSync(f)) throw new Error('COMP-plain needs its workflow file');
    return relativeFrom(this.sb.worktree, f);
  }
}

function relativeFrom(from: string, to: string): string {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

function rerecordNote(rr: RerecordResult): string {
  const files = rr.line?.files ?? [];
  const head = `== re-record (fiks rerecord-head --check ${rr.line?.check ?? '?'}): ${rr.ok ? 'ok' : `FAILED (exit ${rr.code})`}`;
  const body = files.map((f) => `   ${f.mode} ${f.outcome} ${f.path}`).join('\n');
  const err = rr.ok ? '' : `\n${rr.output.split('\n').slice(-20).join('\n')}`;
  return `${head}${body ? `\n${body}` : ''}${err}\n`;
}

/**
 * The COMP-plain CI (PLAN 6.2 E8, "typical-repo CI"): the repo's own ci.yml with its test step
 * limited to the server's own tests, i.e. without the fiks contract suite and stored traces
 * (test/fiks/**). Throws when the workflow has no `pnpm test` step to limit.
 */
export function plainWorkflowText(ciYml: string): string {
  let n = 0;
  const outText = ciYml.replace(/^(\s*(?:- )?run:\s*)pnpm test\s*$/gm, (_m, lead: string) => {
    n++;
    return `${lead}pnpm exec vitest run --exclude "test/fiks/**"`;
  });
  if (n === 0)
    throw new Error('COMP-plain: the workflow has no `run: pnpm test` step to limit to the server tests');
  return outText;
}
