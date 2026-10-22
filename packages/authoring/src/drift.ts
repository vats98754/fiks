// A1 blind authoring (PLAN 5.1-5.3): ideation (half Opus, half the local open-weight model, same
// prompt), seeded idea order, implementation into DriftPackages (with base) by an author in a
// drift/evasive/benign export, an independent ref B by a fixer that never sees ref A, and an LLM
// realism rating. Packages are written into a driftbench-blind checkout.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ruleHash } from '@fiks/injector';
import type { DriftPackage } from '@fiks/interfaces';
import { complete, type LlmDeps, ollamaChat } from '@fiks/llm';
import { type BriefName, briefPath, readBrief } from './briefs.ts';
import { type BuiltExport, buildExport, listFiles, type SourceFile, sha256, textSource } from './export.ts';
import { seededRng, shuffle } from './rng.ts';
import { type AuthorSessionRun, type BashSandbox, runAuthorSession } from './session.ts';
import {
  asDomainId,
  type DomainId,
  docsSources,
  resolveCommit,
  serverSources,
  vendorSources,
} from './sources.ts';

export type Stratum = 'realistic' | 'evasive' | 'benign';
export type IdeationFamily = 'opus' | 'ollama';
export const STRATA: readonly Stratum[] = ['realistic', 'evasive', 'benign'];

/** The server base every blind drift of a domain is applied to (PLAN 3.0). */
export const BLIND_BASE: Record<DomainId, string> = { shop: 'base-shop', tracker: 'seed-tracker-v1' };

export interface Idea {
  /** `<domain>-<stratum>-<nnn>` in idea-index order. */
  ideaId: string;
  ideaIndex: number;
  domain: DomainId;
  stratum: Stratum;
  family: IdeationFamily;
  title: string;
  description: string;
  endpoint?: string;
  category?: string;
  symptom?: string;
  benignClass?: string;
  plausibleString?: boolean;
}

type RawIdea = Omit<Idea, 'ideaId' | 'ideaIndex' | 'domain' | 'stratum' | 'family'>;

const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          endpoint: { type: 'string' },
          category: { type: 'string' },
          symptom: { type: 'string' },
          benignClass: { type: 'string' },
          plausibleString: { type: 'boolean' },
        },
        required: ['title', 'description'],
      },
    },
  },
  required: ['ideas'],
};

/** The ideation prompt: identical for both families (PLAN 5.1). */
export function ideationPrompt(
  domain: DomainId,
  stratum: Stratum,
  n: number,
): { system: string; prompt: string } {
  const brief =
    stratum === 'benign'
      ? readBrief('ideation-benign')
      : `${readBrief('ideation')}${stratum === 'evasive' ? `\n${readBrief('ideation-evasive')}` : ''}`;
  const docs = docsSources(domain)
    .map((f) => `--- ${f.path} ---\n${f.bytes.toString('utf8')}`)
    .join('\n\n');
  const taxonomy = stratum === 'benign' ? '' : `\n\n--- taxonomy ---\n${readBrief('taxonomy')}`;
  return {
    system:
      'You design realistic API-change scenarios for a software-engineering study. Answer with JSON only.',
    prompt: `${brief}\n\nNumber of ideas requested: ${n}.\n\n${docs}${taxonomy}`,
  };
}

function parseIdeas(raw: unknown): RawIdea[] {
  const list = (raw as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) throw new Error('ideation answer has no "ideas" array');
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.title === 'string' && typeof x.description === 'string')
    .map((x) => ({
      title: String(x.title),
      description: String(x.description),
      ...(typeof x.endpoint === 'string' ? { endpoint: x.endpoint } : {}),
      ...(typeof x.category === 'string' ? { category: x.category } : {}),
      ...(typeof x.symptom === 'string' ? { symptom: x.symptom } : {}),
      ...(typeof x.benignClass === 'string' ? { benignClass: x.benignClass } : {}),
      ...(typeof x.plausibleString === 'boolean' ? { plausibleString: x.plausibleString } : {}),
    }));
}

export interface IdeateOptions {
  domain: DomainId;
  stratum: Stratum;
  n: number;
  family: IdeationFamily;
  /** Claude model for the opus family. */
  model: string;
  /** Ollama model (default: the approved model in packages/llm/ollama.json). */
  ollamaModel?: string;
  deps?: LlmDeps;
  llmLogPath?: string;
}

/** One ideation call; returns the ideas (unordered) with their family. */
export async function ideate(o: IdeateOptions): Promise<{ ideas: RawIdea[]; costUsd: number; raw: string }> {
  const { system, prompt } = ideationPrompt(o.domain, o.stratum, o.n);
  if (o.family === 'opus') {
    const r = await complete<unknown>({
      model: o.model,
      system,
      prompt,
      schema: IDEAS_SCHEMA,
      maxTurns: 3,
      label: `ideation:${o.domain}:${o.stratum}`,
      ...(o.llmLogPath ? { logPath: o.llmLogPath } : {}),
      ...(o.deps ? { deps: o.deps } : {}),
    });
    return { ideas: parseIdeas(r.data), costUsd: r.costUsd, raw: r.text };
  }
  const r = await ollamaChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    responseFormat: 'json_object',
    label: `ideation:${o.domain}:${o.stratum}`,
    ...(o.ollamaModel ? { model: o.ollamaModel } : {}),
    ...(o.llmLogPath ? { logPath: o.llmLogPath } : {}),
    ...(o.deps ? { deps: o.deps } : {}),
  });
  const text = r.message.content ?? '';
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return { ideas: parseIdeas(JSON.parse(fenced?.[1] ?? text)), costUsd: 0, raw: text };
}

/**
 * Logs-then-orders ideas (PLAN 5.1): all ideas of one (domain, stratum) from both families are
 * shuffled with a seeded RNG before any implementation; the position is the idea index.
 */
export function orderIdeas(
  domain: DomainId,
  stratum: Stratum,
  byFamily: Partial<Record<IdeationFamily, RawIdea[]>>,
  seed: string | number,
): Idea[] {
  const all: Omit<Idea, 'ideaId' | 'ideaIndex'>[] = [];
  for (const family of ['opus', 'ollama'] as const)
    for (const i of byFamily[family] ?? []) all.push({ ...i, domain, stratum, family });
  return shuffle(all, seededRng(seed, `ideas:${domain}:${stratum}`)).map((x, k) => ({
    ...x,
    ideaIndex: k,
    ideaId: `${domain}-${stratum}-${String(k).padStart(3, '0')}`,
  }));
}

// --- Implementation -------------------------------------------------------------------------

export interface DriftContext {
  domain: DomainId;
  /** Local clone of the domain's server repo (for `git show` of the base and validity checks). */
  repoDir: string;
  /** Checkout of driftbench-blind (packages are written under `drifts/`). */
  blindRepo: string;
  model: string;
  exportRoot?: string;
  logDir: string;
  /** Bash sandbox per session (a `--network none` container); omit to run without Bash. */
  bash?: (exportDir: string) => BashSandbox | undefined;
  deps?: LlmDeps;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Base ref override (default BLIND_BASE[domain]). */
  base?: string;
}

const ideaMd = (idea: Idea) =>
  [
    `# ${idea.title}`,
    '',
    idea.description,
    '',
    ...(idea.endpoint ? [`Endpoint: ${idea.endpoint}`] : []),
    ...(idea.category ? [`Category: ${idea.category}`] : []),
    ...(idea.symptom ? [`Symptom: ${idea.symptom}`] : []),
    ...(idea.benignClass ? [`Class: ${idea.benignClass}`] : []),
    '',
  ].join('\n');

function briefFile(name: BriefName, to: string): SourceFile {
  return { path: to, bytes: Buffer.from(readBrief(name)), origin: briefPath(name) };
}

/** The author's export: the server at base (repo layout) + blind/ (docs, vendor source, briefs, idea). */
export function driftExportFiles(ctx: DriftContext, idea: Idea): SourceFile[] {
  const base = ctx.base ?? BLIND_BASE[ctx.domain];
  const files = [
    ...serverSources(ctx.repoDir, base),
    ...docsSources(ctx.domain, 'blind/docs'),
    ...vendorSources(ctx.domain, 'blind/vendor-v1'),
    textSource('blind/IDEA.md', ideaMd(idea)),
  ];
  if (idea.stratum === 'benign') files.push(briefFile('benign', 'blind/BRIEF.md'));
  else {
    files.push(briefFile('taxonomy', 'blind/TAXONOMY.md'));
    if (idea.stratum === 'evasive') {
      files.push(
        briefFile('drift-evasive', 'blind/BRIEF.md'),
        briefFile('drift-realistic', 'blind/BRIEF-BASE.md'),
      );
    } else files.push(briefFile('drift-realistic', 'blind/BRIEF.md'));
  }
  return files;
}

const exportKind = (s: Stratum) => (s === 'realistic' ? 'drift' : s);

/** A unified diff (git format, repo-relative paths) from `before` to `after`, limited to `src/`. */
export function srcDiff(before: Map<string, Buffer>, afterDir: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'blind-diff-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=blind',
        '-c',
        'user.email=blind@localhost',
        ...args,
      ],
      {
        cwd: tmp,
        maxBuffer: 64 * 1024 * 1024,
      },
    ).toString('utf8');
  try {
    git('init', '-q');
    for (const [p, b] of before) {
      if (!p.startsWith('src/')) continue;
      mkdirSync(dirname(join(tmp, p)), { recursive: true });
      writeFileSync(join(tmp, p), b);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    rmSync(join(tmp, 'src'), { recursive: true, force: true });
    if (existsSync(join(afterDir, 'src')))
      cpSync(join(afterDir, 'src'), join(tmp, 'src'), { recursive: true });
    git('add', '-A');
    return git('diff', '--cached', '--binary', 'HEAD');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface AuthoredDrift {
  idea: Idea;
  id: string;
  pkgFile?: string;
  pkg?: DriftPackage;
  run: AuthorSessionRun;
  export: BuiltExport;
  problems: string[];
  /** Excluded for a forbidden read or a sentinel in the transcript (recorded). */
  excludedByAudit: boolean;
}

const readIf = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);

/** One implementation session; writes the DriftPackage when the outputs are complete. */
export async function implementDrift(ctx: DriftContext, idea: Idea): Promise<AuthoredDrift> {
  const id = idea.ideaId;
  const base = ctx.base ?? BLIND_BASE[ctx.domain];
  const exp = buildExport({
    kind: exportKind(idea.stratum),
    label: id,
    domain: ctx.domain,
    files: driftExportFiles(ctx, idea),
    ...(ctx.exportRoot ? { root: ctx.exportRoot } : {}),
  });
  const bash = ctx.bash?.(exp.dir);
  const run = await runAuthorSession({
    kind: exp.manifest.kind,
    label: `${id}.author`,
    exportDir: exp.dir,
    prompt: `Read blind/BRIEF.md and blind/IDEA.md in your working directory, then do the task they describe.`,
    model: ctx.model,
    tools: bash
      ? ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'Bash']
      : ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit'],
    budget: { maxTurns: ctx.maxTurns ?? 80, maxBudgetUsd: ctx.maxBudgetUsd ?? 5 },
    ...(bash ? { bash } : {}),
    logDir: ctx.logDir,
    ...(ctx.deps ? { deps: ctx.deps } : {}),
  });
  const out: AuthoredDrift = { idea, id, run, export: exp, problems: [], excludedByAudit: !run.audit.ok };
  if (!run.session.ok) out.problems.push(`session ${run.session.outcome}`);
  if (!run.audit.ok)
    out.problems.push(
      `audit: forbidden reads ${run.audit.forbiddenReads.length}, sentinels ${run.audit.sentinelHits.join('|')}`,
    );
  if (out.problems.length) return out;

  const d = exp.dir;
  const transform = readIf(join(d, 'blind/out/transform.ts'));
  const matchRaw = readIf(join(d, 'blind/out/match.json'));
  const meta = readIf(join(d, 'blind/out/drift.json'));
  const generators = readIf(join(d, 'blind/out/generators.ts'));
  const hiddenDir = join(d, 'test/hidden');
  const hidden = existsSync(hiddenDir)
    ? readdirSync(hiddenDir)
        .filter((f) => f.endsWith('.test.ts'))
        .sort()
    : [];
  const renamedDir = join(d, 'blind/out/hidden-renamed');
  const renamed = existsSync(renamedDir)
    ? readdirSync(renamedDir)
        .filter((f) => f.endsWith('.test.ts'))
        .sort()
    : [];
  if (!transform) out.problems.push('no blind/out/transform.ts');
  if (!matchRaw) out.problems.push('no blind/out/match.json');
  if (!meta) out.problems.push('no blind/out/drift.json');
  if (!generators) out.problems.push('no blind/out/generators.ts');
  if (hidden.length < 3) out.problems.push(`${hidden.length} hidden tests (need >= 3)`);
  if (renamed.join() !== hidden.join())
    out.problems.push('hidden-renamed/ does not hold the same test files');
  let match: { method: string; pathPattern: string } | undefined;
  try {
    match = matchRaw ? (JSON.parse(matchRaw) as { method: string; pathPattern: string }) : undefined;
  } catch {
    out.problems.push('match.json is not JSON');
  }
  let driftMeta: Record<string, unknown> = {};
  try {
    driftMeta = meta ? (JSON.parse(meta) as Record<string, unknown>) : {};
  } catch {
    out.problems.push('drift.json is not JSON');
  }
  if (out.problems.length) return out;

  // "Before" = the base files the author was shown (an excluded file would otherwise read as deleted).
  const shown = new Set(exp.manifest.files.map((f) => f.path));
  const baseFiles = new Map(
    serverSources(ctx.repoDir, base)
      .filter((f) => shown.has(f.path))
      .map((f) => [f.path, f.bytes]),
  );
  const refA = idea.stratum === 'benign' ? '' : srcDiff(baseFiles, d);
  if (idea.stratum !== 'benign' && !refA.trim()) {
    out.problems.push('ref A is empty (no change under src/)');
    return out;
  }
  if (idea.stratum === 'benign' && srcDiff(baseFiles, d).trim())
    out.problems.push('a benign author changed src/ (ignored)');

  // Package layout (paths relative to the manifest's directory, like TRK-DEV-1).
  const drifts = join(ctx.blindRepo, 'drifts');
  const dir = join(drifts, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'hidden'), { recursive: true });
  mkdirSync(join(dir, 'hidden-renamed'), { recursive: true });
  writeFileSync(join(dir, 'transform.ts'), transform as string);
  const ruleBase = {
    id,
    domain: ctx.domain,
    match: { method: String(match?.method ?? '*'), pathPattern: String(match?.pathPattern ?? '') },
    transform: 'transform.ts',
    clockFrozen: true,
  };
  const hash = ruleHash(ruleBase, join(dir, 'transform.ts'));
  writeFileSync(join(dir, 'rule.json'), `${JSON.stringify({ ...ruleBase, hash }, null, 2)}\n`);
  for (const f of hidden) cpSync(join(hiddenDir, f), join(dir, 'hidden', f));
  for (const f of renamed) cpSync(join(renamedDir, f), join(dir, 'hidden-renamed', f));
  writeFileSync(join(dir, 'generators.ts'), generators as string);
  if (refA) writeFileSync(join(dir, 'refA.patch'), refA);
  const changelogRaw =
    typeof driftMeta.changelog === 'string' && driftMeta.changelog.trim() ? driftMeta.changelog : undefined;
  // Benign cases: a seeded half get the vendor changelog entry (PLAN 5.3). Drifts are silent.
  const withChangelog =
    idea.stratum === 'benign' && changelogRaw !== undefined && seededRng(id, 'changelog')() < 0.5;
  writeFileSync(join(dir, 'drift.json'), `${JSON.stringify({ ...driftMeta, idea }, null, 2)}\n`);
  writeFileSync(
    join(dir, 'authoring.json'),
    `${JSON.stringify(
      {
        stage: 'author',
        model: ctx.model,
        base,
        baseCommit: resolveCommit(ctx.repoDir, base),
        sessionId: run.session.sessionId ?? null,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        exportManifestSha256: exp.manifestSha256,
        transcriptSha256: run.transcriptSha256,
        transcript: basename(run.transcriptPath),
        costUsd: run.session.costUsd,
        audit: run.audit,
      },
      null,
      2,
    )}\n`,
  );
  const pkg: DriftPackage = {
    id,
    domain: ctx.domain,
    base,
    stratum: idea.stratum,
    ideationFamily: idea.family,
    authorSession: run.session.sessionId ?? `${id}.author`,
    injectorRule: { path: `${id}/rule.json`, hash },
    hiddenTests: hidden.map((f) => `${id}/hidden/${f}`),
    refA: refA ? `${id}/refA.patch` : '',
    refB: '',
    renamedIdVariant: `${id}/hidden-renamed`,
    generators: [`${id}/generators.ts`],
    ...(withChangelog ? { changelog: changelogRaw } : {}),
  };
  const pkgFile = join(drifts, `${id}.json`);
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  return { ...out, pkg, pkgFile };
}

export function readPackage(pkgFile: string): DriftPackage {
  return JSON.parse(readFileSync(pkgFile, 'utf8')) as DriftPackage;
}

const driftMd = (pkgFile: string, pkg: DriftPackage) => {
  const dir = dirname(pkgFile);
  const metaFile = join(dir, pkg.id, 'drift.json');
  const meta = (
    existsSync(metaFile)
      ? JSON.parse(readFileSync(metaFile, 'utf8'))
      : { title: pkg.id, summary: pkg.changelog ?? '' }
  ) as Record<string, unknown>;
  const rule = JSON.parse(readFileSync(join(dir, pkg.injectorRule.path), 'utf8')) as { match: unknown };
  return [
    `# ${String(meta.title ?? pkg.id)}`,
    '',
    String(meta.summary ?? ''),
    '',
    `Requests affected: ${JSON.stringify(rule.match)}`,
    ...(pkg.changelog ? ['', `Vendor changelog: ${pkg.changelog}`] : []),
    '',
  ].join('\n');
};

/** The fixer's export: the server at the drift's base + the hidden tests + the drift description. Never ref A. */
export function fixerExportFiles(repoDir: string, pkgFile: string, baseOverride?: string): SourceFile[] {
  const pkg = readPackage(pkgFile);
  const dir = dirname(pkgFile);
  return [
    ...serverSources(repoDir, baseOverride ?? pkg.base),
    ...pkg.hiddenTests.map((h) => ({
      path: `test/hidden/${basename(h)}`,
      bytes: readFileSync(join(dir, h)),
      origin: join(dir, h),
    })),
    ...docsSources(asDomainId(pkg.domain), 'blind/docs'),
    ...vendorSources(asDomainId(pkg.domain), 'blind/vendor-v1'),
    briefFile('fixer', 'blind/BRIEF.md'),
    textSource('blind/DRIFT.md', driftMd(pkgFile, pkg)),
    {
      path: 'blind/drift/transform.ts',
      bytes: readFileSync(ruleTransform(pkgFile, pkg)),
      origin: ruleTransform(pkgFile, pkg),
    },
  ];
}

/** The rater's export: docs, the brief, the drift description and its transform. */
export function raterExportFiles(pkgFile: string): SourceFile[] {
  const pkg = readPackage(pkgFile);
  return [
    ...docsSources(asDomainId(pkg.domain)),
    briefFile('rater', 'BRIEF.md'),
    textSource('DRIFT.md', driftMd(pkgFile, pkg)),
    {
      path: 'drift/transform.ts',
      bytes: readFileSync(ruleTransform(pkgFile, pkg)),
      origin: ruleTransform(pkgFile, pkg),
    },
  ];
}

/** The transform module of a package's rule (resolved like the injector does). */
function ruleTransform(pkgFile: string, pkg: DriftPackage): string {
  const rulePath = join(dirname(pkgFile), pkg.injectorRule.path);
  const rule = JSON.parse(readFileSync(rulePath, 'utf8')) as { transform: string };
  return join(dirname(rulePath), rule.transform);
}

/** Ref B: an independent fixer (sees the drift and the hidden tests, never ref A). */
export async function fixDrift(
  ctx: DriftContext,
  pkgFile: string,
): Promise<{ ok: boolean; problems: string[]; run: AuthorSessionRun }> {
  const pkg = readPackage(pkgFile);
  const dir = dirname(pkgFile);
  const files = fixerExportFiles(ctx.repoDir, pkgFile);
  const exp = buildExport({
    kind: 'fixer',
    label: pkg.id,
    domain: pkg.domain,
    files,
    ...(ctx.exportRoot ? { root: ctx.exportRoot } : {}),
  });
  const bash = ctx.bash?.(exp.dir);
  const run = await runAuthorSession({
    kind: 'fixer',
    label: `${pkg.id}.fixer`,
    exportDir: exp.dir,
    prompt:
      'Read blind/BRIEF.md and blind/DRIFT.md in your working directory, then do the task they describe.',
    model: ctx.model,
    tools: bash
      ? ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'Bash']
      : ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit'],
    budget: { maxTurns: ctx.maxTurns ?? 60, maxBudgetUsd: ctx.maxBudgetUsd ?? 5 },
    ...(bash ? { bash } : {}),
    logDir: ctx.logDir,
    ...(ctx.deps ? { deps: ctx.deps } : {}),
  });
  const problems: string[] = [];
  if (!run.session.ok) problems.push(`session ${run.session.outcome}`);
  if (!run.audit.ok) problems.push('transcript audit failed');
  const shown = new Set(exp.manifest.files.map((f) => f.path));
  const baseFiles = new Map(
    serverSources(ctx.repoDir, pkg.base)
      .filter((f) => shown.has(f.path))
      .map((f) => [f.path, f.bytes]),
  );
  const refB = problems.length ? '' : srcDiff(baseFiles, exp.dir);
  if (!problems.length && !refB.trim()) problems.push('ref B is empty');
  if (!problems.length) {
    writeFileSync(join(dir, pkg.id, 'refB.patch'), refB);
    writeFileSync(pkgFile, `${JSON.stringify({ ...pkg, refB: `${pkg.id}/refB.patch` }, null, 2)}\n`);
  }
  writeFileSync(
    join(dir, pkg.id, 'fixer.json'),
    `${JSON.stringify(
      {
        stage: 'fixer',
        model: ctx.model,
        sessionId: run.session.sessionId ?? null,
        exportManifestSha256: exp.manifestSha256,
        transcriptSha256: run.transcriptSha256,
        transcript: basename(run.transcriptPath),
        problems,
        audit: run.audit,
      },
      null,
      2,
    )}\n`,
  );
  return { ok: problems.length === 0, problems, run };
}

/** The realism rating (D6): a separate rater session, Sonnet by default; never used to filter. */
export async function rateDrift(
  ctx: DriftContext & { raterModel: string },
  pkgFile: string,
): Promise<{ score: number | null; rationale: string; run: AuthorSessionRun }> {
  const pkg = readPackage(pkgFile);
  const dir = dirname(pkgFile);
  const exp = buildExport({
    kind: 'rater',
    label: pkg.id,
    domain: pkg.domain,
    files: raterExportFiles(pkgFile),
    ...(ctx.exportRoot ? { root: ctx.exportRoot } : {}),
  });
  const run = await runAuthorSession({
    kind: 'rater',
    label: `${pkg.id}.rater`,
    exportDir: exp.dir,
    prompt: readBrief('rater'),
    model: ctx.raterModel,
    tools: ['Read', 'Glob', 'Grep'],
    budget: { maxTurns: 10, maxBudgetUsd: 1 },
    outputSchema: {
      type: 'object',
      properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, rationale: { type: 'string' } },
      required: ['score', 'rationale'],
    },
    logDir: ctx.logDir,
    ...(ctx.deps ? { deps: ctx.deps } : {}),
  });
  const so = run.session.structuredOutput as { score?: unknown; rationale?: unknown } | undefined;
  const score =
    Number.isInteger(so?.score) && (so?.score as number) >= 1 && (so?.score as number) <= 5
      ? (so?.score as number)
      : null;
  const rationale = typeof so?.rationale === 'string' ? so.rationale : '';
  const rating = {
    drift: pkg.id,
    rater: ctx.raterModel,
    label: 'LLM rating (D6)',
    score,
    rationale,
    sessionId: run.session.sessionId ?? null,
    transcriptSha256: run.transcriptSha256,
  };
  writeFileSync(join(dir, pkg.id, 'rating.json'), `${JSON.stringify(rating, null, 2)}\n`);
  return { score, rationale, run };
}

/** Moves a discarded attempt's package and logs aside (cap-stop quarantine). */
export function quarantine(blindRepo: string, id: string, attempt: number, reason: string): void {
  const q = join(blindRepo, 'quarantine', `${id}.attempt${attempt}`);
  mkdirSync(q, { recursive: true });
  for (const p of [join(blindRepo, 'drifts', id), join(blindRepo, 'drifts', `${id}.json`)]) {
    if (existsSync(p)) {
      cpSync(p, join(q, basename(p)), { recursive: true });
      rmSync(p, { recursive: true, force: true });
    }
  }
  writeFileSync(join(q, 'REASON.txt'), `${reason}\n`);
}

export { listFiles, sha256 };
