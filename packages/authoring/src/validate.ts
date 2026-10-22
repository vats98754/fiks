// validate-drift (PLAN 5.1, R0): automated validity of one DriftPackage. Checks, in order:
//   schema      the manifest (and its rule, with hash) is complete;
//   base        `base^{commit}` resolves in the local server clone (no fetch);
//   spec        the published spec is unchanged under the rule (GET /openapi.json through the
//               injector == without it), and no ref touches the spec or docs;
//   determinism two fresh chains (vendor v1 + rule, frozen clock) give byte-identical upstream
//               exchanges and tool outputs for the domain's fixture calls and the generators;
//   base-fails  drifts: >= 1 hidden test fails on base; benign: every hidden test passes on base;
//   refA/refB   every hidden test and its renamed-id variant pass with the ref applied.
// Hidden tests run in throwaway worktrees of the clone (node_modules shared from the clone).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HttpExchange } from '@fiks/contracts';
import { startInjector, validateDriftPackage } from '@fiks/injector';
import type { Domain, DriftPackage } from '@fiks/interfaces';
import { sha256 } from './export.ts';
import { type ChainOptions, startChain } from './record.ts';
import { canonicalJson, seededRng } from './rng.ts';
import { resolveCommit } from './sources.ts';

export interface ValidityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ValidityReport {
  id: string;
  valid: boolean;
  checks: ValidityCheck[];
}

export interface ValidateOptions {
  pkgFile: string;
  domain: Domain;
  /** Local clone of the domain's server repo (default: the domain's repo dir). */
  repoDir?: string;
  /** Require ref B (default: when the manifest names one). */
  requireRefB?: boolean;
  /** Number of generator inputs used by the determinism check (default 20). */
  generatorInputs?: number;
  log?: (line: string) => void;
}

const SPEC_PATHS = ['/openapi.json'];
const SPEC_FILE_RE = /(^|\/)(openapi\.json|docs\/)/;

const rel = (pkgFile: string, p: string) => (isAbsolute(p) ? p : resolve(dirname(pkgFile), p));

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

/** A detached worktree of `commit` with the clone's node_modules linked in. */
function worktree(repoDir: string, commit: string): { dir: string; remove(): void } {
  if (!existsSync(join(repoDir, 'node_modules')))
    throw new Error(`${repoDir} has no node_modules (run the ensure script)`);
  const dir = join(mkdtempSync(join(tmpdir(), 'blind-validate-')), 'repo');
  git(repoDir, ['worktree', 'add', '--detach', '--quiet', dir, commit]);
  symlinkSync(realpathSync(join(repoDir, 'node_modules')), join(dir, 'node_modules'));
  return {
    dir,
    remove() {
      try {
        git(repoDir, ['worktree', 'remove', '--force', dir]);
      } catch {
        rmSync(dir, { recursive: true, force: true });
        git(repoDir, ['worktree', 'prune']);
      }
    },
  };
}

interface VitestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  error?: string;
}

/** Copies `files` into <wt>/test/hidden and runs them with vitest (JSON reporter). */
function runHidden(wt: string, files: string[]): VitestReport {
  const dest = join(wt, 'test/hidden');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of files) cpSync(f, join(dest, basename(f)));
  const out = join(mkdtempSync(join(tmpdir(), 'blind-vitest-')), 'report.json');
  const r = spawnSync(
    join(wt, 'node_modules/.bin/vitest'),
    ['run', '--reporter=json', `--outputFile=${out}`, 'test/hidden'],
    {
      cwd: wt,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: tmpdir(), CI: '1' },
      timeout: 10 * 60_000,
    },
  );
  if (!existsSync(out))
    return {
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      error: `vitest wrote no report (exit ${r.status}): ${(r.stderr ?? '').slice(0, 500)}`,
    };
  const j = JSON.parse(readFileSync(out, 'utf8')) as VitestReport & {
    testResults?: { status: string; message?: string }[];
  };
  const suiteErr = (j.testResults ?? [])
    .filter((t) => t.status === 'failed' && t.message)
    .map((t) => t.message);
  return {
    numTotalTests: j.numTotalTests,
    numPassedTests: j.numPassedTests,
    numFailedTests: j.numFailedTests,
    ...(suiteErr.length && j.numTotalTests === 0 ? { error: String(suiteErr[0]).slice(0, 500) } : {}),
  };
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const r = await fetch(url);
  return { status: r.status, body: await r.text() };
}

/** The upstream requests the server makes for `calls` (one chain run with the rule in place). */
async function upstreamRequests(
  opts: ChainOptions,
  calls: { tool: string; args: Record<string, unknown> }[],
): Promise<HttpExchange['request'][]> {
  const c = await startChain(opts);
  try {
    const out: HttpExchange['request'][] = [];
    for (const k of calls) out.push(...(await c.call(k.tool, k.args)).upstream.map((x) => x.request));
    return out;
  } finally {
    await c.close();
  }
}

const HOP = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'date']);

/**
 * Sends `requests` in order to a fresh vendor v1 (frozen clock) behind a fresh injector and
 * returns the normalized responses. The server is not involved, so its own randomness (e.g. an
 * idempotency key) cannot be mistaken for a nondeterministic rule.
 */
async function injectorReplay(
  domain: Domain,
  rulePath: string,
  requests: HttpExchange['request'][],
): Promise<string> {
  const vendor = domain.createVendor('original', { version: 'v1', now: () => new Date(domain.frozenClock) });
  const vurl = await vendor.listen();
  const inj = await startInjector({ target: vurl, rule: rulePath, clock: domain.frozenClock });
  try {
    const out: unknown[] = [];
    for (const r of requests) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
      const res = await fetch(`${inj.url}${r.url}`, {
        method: r.method,
        headers,
        ...(r.body !== null && r.method !== 'GET' && r.method !== 'HEAD' ? { body: r.body } : {}),
      });
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (!HOP.has(k)) h[k] = v;
      });
      out.push({ method: r.method, url: r.url, status: res.status, headers: h, body: await res.text() });
    }
    return canonicalJson(out);
  } finally {
    await inj.close();
    await vendor.close();
  }
}

export async function validateDrift(o: ValidateOptions): Promise<ValidityReport> {
  const say = o.log ?? (() => {});
  const checks: ValidityCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    say(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  };
  const raw = JSON.parse(readFileSync(o.pkgFile, 'utf8')) as DriftPackage;
  const benign = raw.stratum === 'benign';
  const report = (): ValidityReport => ({ id: raw.id, valid: checks.every((c) => c.ok), checks });

  // schema
  // `complete` would also demand ref B, which A1 adds only after the keep rule: checked here instead.
  const schema = await validateDriftPackage(o.pkgFile, { complete: false });
  const hidden = (raw.hiddenTests ?? []).map((h) => rel(o.pkgFile, h));
  const renamedDir = raw.renamedIdVariant ? rel(o.pkgFile, raw.renamedIdVariant) : '';
  const renamed =
    renamedDir && existsSync(renamedDir)
      ? readdirSync(renamedDir)
          .filter((f) => f.endsWith('.test.ts'))
          .sort()
          .map((f) => join(renamedDir, f))
      : [];
  const schemaErrs = [...schema.errors];
  if (hidden.length < 3) schemaErrs.push(`${hidden.length} hidden tests (need >= 3)`);
  if (!benign && !raw.refA) schemaErrs.push('ref A is empty');
  if (o.requireRefB && !benign && !raw.refB) schemaErrs.push('ref B is empty');
  if (!raw.renamedIdVariant) schemaErrs.push('renamedIdVariant is empty');
  for (const h of hidden) if (!existsSync(h)) schemaErrs.push(`missing hidden test ${h}`);
  if (
    renamed.map((f) => basename(f)).join() !==
    hidden
      .map((f) => basename(f))
      .sort()
      .join()
  )
    schemaErrs.push('the renamed-id variant does not hold the same test files');
  if (raw.domain !== o.domain.id) schemaErrs.push(`package domain ${raw.domain} != --domain ${o.domain.id}`);
  add('schema', schemaErrs.length === 0, schemaErrs.join('; ') || 'complete manifest; rule hash matches');
  if (schemaErrs.length) return report();
  const pkg = schema.pkg as DriftPackage;
  const rulePath = rel(o.pkgFile, pkg.injectorRule.path);

  // base
  const repoDir = o.repoDir ?? o.domain.repo.dir();
  let commit = '';
  try {
    commit = resolveCommit(repoDir, pkg.base);
    add('base', true, `${pkg.base}^{commit} = ${commit}`);
  } catch {
    add('base', false, `${pkg.base}^{commit} does not resolve in ${repoDir}`);
    return report();
  }

  // spec
  {
    const problems: string[] = [];
    const vendor = o.domain.createVendor('original', {
      version: 'v1',
      now: () => new Date(o.domain.frozenClock),
    });
    const vurl = await vendor.listen();
    const inj = await startInjector({ target: vurl, rule: rulePath, clock: o.domain.frozenClock });
    try {
      for (const p of SPEC_PATHS) {
        const a = await fetchText(`${vurl}${p}`);
        const b = await fetchText(`${inj.url}${p}`);
        if (a.status !== b.status || a.body !== b.body) problems.push(`GET ${p} differs under the rule`);
      }
    } finally {
      await inj.close();
      await vendor.close();
    }
    for (const ref of [pkg.refA, pkg.refB].filter(Boolean)) {
      const text = readFileSync(rel(o.pkgFile, ref), 'utf8');
      for (const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) {
        if (SPEC_FILE_RE.test(m[1] as string) || SPEC_FILE_RE.test(m[2] as string))
          problems.push(`${ref} edits ${m[2]}`);
      }
    }
    add('spec', problems.length === 0, problems.join('; ') || 'published spec unchanged');
  }

  // determinism
  {
    const calls: { tool: string; args: Record<string, unknown> }[] = o.domain.fixtureCalls.map(
      ({ tool, args }) => ({ tool, args }),
    );
    for (const g of pkg.generators) {
      try {
        const mod = (await import(pathToFileURL(rel(o.pkgFile, g)).href)) as { default?: unknown };
        if (typeof mod.default === 'function') {
          const gen = (mod.default as (r: () => number) => { tool: string; args: Record<string, unknown> }[])(
            seededRng(pkg.id, 'generators'),
          );
          calls.push(...gen.slice(0, o.generatorInputs ?? 20));
        }
      } catch (e) {
        add('generators', false, `${g}: ${(e as Error).message}`);
      }
    }
    const chain: ChainOptions = { domain: o.domain, repoDir, rulePath };
    try {
      const requests = await upstreamRequests(chain, calls);
      const a = await injectorReplay(o.domain, rulePath, requests);
      const b = await injectorReplay(o.domain, rulePath, requests);
      add(
        'determinism',
        a === b,
        a === b
          ? `${requests.length} upstream requests (${calls.length} calls) replayed twice through fresh rule instances: identical (sha256 ${sha256(a).slice(0, 12)})`
          : `${requests.length} upstream requests replayed twice through fresh rule instances: responses differ`,
      );
    } catch (e) {
      add('determinism', false, `replay failed: ${(e as Error).message}`);
    }
  }

  // hidden tests on base / refs
  const wts: { remove(): void }[] = [];
  try {
    const baseWt = worktree(repoDir, commit);
    wts.push(baseWt);
    const onBase = runHidden(baseWt.dir, hidden);
    if (onBase.error || onBase.numTotalTests === 0)
      add(benign ? 'base-passes' : 'base-fails', false, onBase.error ?? 'no tests ran');
    else if (benign)
      add(
        'base-passes',
        onBase.numFailedTests === 0,
        `${onBase.numPassedTests}/${onBase.numTotalTests} pass on base (benign: all must pass)`,
      );
    else
      add(
        'base-fails',
        onBase.numFailedTests >= 1,
        `${onBase.numFailedTests}/${onBase.numTotalTests} fail on base (need >= 1)`,
      );
    const refs: [string, string][] = [];
    if (pkg.refA) refs.push(['refA', pkg.refA]);
    if (pkg.refB) refs.push(['refB', pkg.refB]);
    for (const [name, ref] of refs) {
      const wt = worktree(repoDir, commit);
      wts.push(wt);
      try {
        git(wt.dir, ['apply', rel(o.pkgFile, ref)]);
      } catch (e) {
        add(name, false, `git apply failed: ${(e as Error).message.slice(0, 300)}`);
        continue;
      }
      const h = runHidden(wt.dir, hidden);
      const r = runHidden(wt.dir, renamed);
      const ok =
        !h.error &&
        !r.error &&
        h.numFailedTests === 0 &&
        h.numPassedTests === hidden.length &&
        r.numFailedTests === 0 &&
        r.numPassedTests === renamed.length;
      add(
        name,
        ok,
        `hidden ${h.numPassedTests}/${h.numTotalTests} pass${h.error ? ` (${h.error})` : ''}; renamed ${r.numPassedTests}/${r.numTotalTests} pass${r.error ? ` (${r.error})` : ''}`,
      );
    }
  } finally {
    for (const w of wts) w.remove();
  }
  return report();
}
