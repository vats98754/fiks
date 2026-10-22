// `fiks author` (stream BLIND; PLAN 5.1-5.3, 8.1 A0/A1/A2): the sealed blind-authoring pipeline.
//
//   pnpm fiks author --kind catalog --domain <d> --batches <n> [--top-up]
//   pnpm fiks author --kind contract --domain <d> [--protocol tracker|shop-blind|llm --seed n] [--sdev-records f]
//   pnpm fiks author --kind ideas --domain <d> --stratum realistic|evasive|benign --n <N> --seed <s>
//   pnpm fiks author --kind drift|evasive|benign --domain <d> (--ideas <ideas.jsonl> | --dry-run)
//       [--concurrency c | --throughput paper/results/raw/throughput.json] [--ceiling-usd 1000]
//       [--ceiling-sessions 520] [--limit n] [--no-rating]
//   pnpm fiks author --kind export --export-kind <k> --domain <d> [--ref <ref>] [--pkg <driftpkg.json>]
//   pnpm fiks author --check-no-bounds [--brief f]... [--docs f]... [--contracts f]...
//
// Common: --out-root <dir> (prefix of every reserved output path; default the repo root),
// --export-root <dir>, --blind-repo <dir>, --log-dir <dir>, --repo-dir <server clone>,
// --model (default claude-opus-5-5), --rater-model (default claude-sonnet-5-5),
// --llm-stub <module> (stub author: no Claude or ollama call), --no-sandbox (no Bash tool).
// Without --llm-stub the command refuses while $HOME/.fiks/build-swarm.active exists (PLAN 7.1).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  asDomainId,
  authorCatalog,
  authorContract,
  BASE_IMAGE,
  type BashSandbox,
  BLIND_BASE,
  briefPath,
  buildExport,
  buildRepoImage,
  type ContractProtocol,
  catalogBriefName,
  checkNoBounds,
  concurrencyFromThroughput,
  contractInputs,
  DEFAULT_QUOTAS,
  type DriftContext,
  defaultProtocol,
  dockerBash,
  docsSources,
  driftExportFiles,
  EXPORT_KINDS,
  type ExportKind,
  FIKS_ROOT,
  fixerExportFiles,
  formatNoBounds,
  type Idea,
  type IdeationFamily,
  ideate,
  type LlmDeps,
  loadStub,
  orderIdeas,
  raterExportFiles,
  runA1,
  STRATA,
  type Stratum,
  stubDeps,
  textSource,
  validateDrift,
} from '@fiks/authoring';
import { getDomain } from '@fiks/domains';
import type { CliCommandModule, Domain } from '@fiks/interfaces';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_RATER = 'claude-sonnet-5-5';
const BUILD_SWARM = join(homedir(), '.fiks', 'build-swarm.active');

const USAGE = `usage: fiks author --kind catalog|contract|ideas|drift|evasive|benign|export --domain shop|tracker [options]
       fiks author --check-no-bounds [--brief f]... [--docs f]... [--contracts f]...
see packages/cli/src/commands/author.ts for every option`;

const OPTIONS = {
  kind: { type: 'string' },
  domain: { type: 'string' },
  batches: { type: 'string' },
  'top-up': { type: 'boolean', default: false },
  protocol: { type: 'string' },
  seed: { type: 'string' },
  'sdev-records': { type: 'string' },
  stratum: { type: 'string' },
  n: { type: 'string' },
  families: { type: 'string', default: 'opus,ollama' },
  'ollama-model': { type: 'string' },
  ideas: { type: 'string' },
  limit: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  concurrency: { type: 'string' },
  throughput: { type: 'string' },
  'ceiling-usd': { type: 'string' },
  'ceiling-sessions': { type: 'string' },
  'no-rating': { type: 'boolean', default: false },
  'export-kind': { type: 'string' },
  ref: { type: 'string' },
  pkg: { type: 'string' },
  'check-no-bounds': { type: 'boolean', default: false },
  brief: { type: 'string', multiple: true },
  docs: { type: 'string', multiple: true },
  contracts: { type: 'string', multiple: true },
  'out-root': { type: 'string' },
  'export-root': { type: 'string' },
  'blind-repo': { type: 'string' },
  'log-dir': { type: 'string' },
  'repo-dir': { type: 'string' },
  model: { type: 'string', default: DEFAULT_MODEL },
  'rater-model': { type: 'string', default: DEFAULT_RATER },
  'llm-stub': { type: 'string' },
  'no-sandbox': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: false }>>['values'];

const int = (v: string | undefined, name: string, dflt?: number): number => {
  if (v === undefined) {
    if (dflt === undefined) throw new Error(`--${name} is required`);
    return dflt;
  }
  if (!/^\d+$/.test(v)) throw new Error(`--${name} must be a non-negative integer`);
  return Number(v);
};

async function llm(v: Values): Promise<{ deps?: LlmDeps; ollamaModel?: string; stub: boolean }> {
  if (v['llm-stub']) {
    const d = stubDeps(await loadStub(v['llm-stub']));
    return { deps: d, ollamaModel: d.ollamaModel, stub: true };
  }
  if (existsSync(BUILD_SWARM))
    throw new Error(`refusing a live authoring run while ${BUILD_SWARM} exists (PLAN 7.1); use --llm-stub`);
  return { ...(v['ollama-model'] ? { ollamaModel: v['ollama-model'] } : {}), stub: false };
}

function domainOf(v: Values): Domain {
  if (!v.domain) throw new Error('--domain is required');
  return getDomain(asDomainId(v.domain));
}

/** Bash for contract kinds: a plain node image (no repo needed), `--network none`. */
const plainBash =
  (v: Values) =>
  (dir: string): BashSandbox | undefined =>
    v['no-sandbox'] ? undefined : dockerBash({ exportDir: dir, image: BASE_IMAGE });

/** Bash for drift/fixer kinds: the server's repo image (node_modules), built lazily on first use. */
const repoBash =
  (v: Values, repoDir: string, ref: string) =>
  (dir: string): BashSandbox | undefined =>
    v['no-sandbox']
      ? undefined
      : dockerBash({
          exportDir: dir,
          image: async () => (await buildRepoImage({ repo: repoDir, ref })).digest,
          nodeModules: 'image',
        });

const outRoot = (v: Values) => resolve(v['out-root'] ?? FIKS_ROOT);
const blindRepo = (v: Values) => resolve(v['blind-repo'] ?? join(outRoot(v), '.work', 'driftbench-blind'));

async function runCheckNoBounds(v: Values): Promise<number> {
  const r = checkNoBounds({
    ...(v.brief?.length ? { briefs: v.brief.map((f) => resolve(f)) } : {}),
    ...(v.docs?.length ? { extraDocs: v.docs.map((f) => resolve(f)) } : {}),
    ...(v.contracts?.length ? { contracts: v.contracts.map((f) => resolve(f)) } : {}),
  });
  console.log(v.json ? JSON.stringify(r, null, 2) : formatNoBounds(r));
  return r.ok ? 0 : 1;
}

async function runContract(v: Values): Promise<number> {
  const domain = domainOf(v);
  const protocol = (v.protocol ?? defaultProtocol(domain.id)) as ContractProtocol;
  if (!['tracker', 'shop-blind', 'llm'].includes(protocol)) throw new Error(`unknown --protocol ${protocol}`);
  const { deps } = await llm(v);
  const r = await authorContract({
    domain,
    protocol,
    ...(v.seed !== undefined ? { seed: int(v.seed, 'seed') } : {}),
    outRoot: outRoot(v),
    model: v.model,
    ...(v['export-root'] ? { exportRoot: resolve(v['export-root']) } : {}),
    ...(v['log-dir'] ? { logDir: resolve(v['log-dir']) } : {}),
    ...(v['repo-dir'] ? { repoDir: resolve(v['repo-dir']) } : {}),
    ...(v['sdev-records'] ? { sdevRecords: resolve(v['sdev-records']) } : {}),
    bash: plainBash(v),
    ...(deps ? { deps } : {}),
    force: v.force,
    log: (l) => console.log(l),
  });
  console.log(`export: ${r.export.dir} (manifest ${r.export.manifestPath})`);
  console.log(`transcript: ${r.transcriptPath}`);
  if (!r.ok) {
    console.error(`contract rejected; nothing written:\n  ${r.errors.join('\n  ')}`);
    if (r.rejectedPath) console.error(`details: ${r.rejectedPath}`);
    return 1;
  }
  console.log(`wrote ${r.contractPath}`);
  console.log(`wrote ${r.logPath}`);
  return 0;
}

async function runCatalog(v: Values): Promise<number> {
  const domain = asDomainId(v.domain ?? '');
  const { deps } = await llm(v);
  const r = await authorCatalog({
    domain,
    batches: int(v.batches, 'batches'),
    topUp: v['top-up'],
    outRoot: outRoot(v),
    model: v.model,
    ...(v['export-root'] ? { exportRoot: resolve(v['export-root']) } : {}),
    ...(v['log-dir'] ? { logDir: resolve(v['log-dir']) } : {}),
    ...(deps ? { deps } : {}),
    log: (l) => console.log(l),
  });
  console.log(`catalog ${domain}: +${r.added} entities (${r.total} total) -> ${r.file}`);
  if (r.stoppedByCap) {
    console.error('stopped by a usage cap: re-run with --top-up after the reset');
    return 3;
  }
  return 0;
}

const ideasFile = (v: Values, domain: string, stratum: string) =>
  join(blindRepo(v), 'ideas', `${domain}-${stratum}.jsonl`);

async function runIdeas(v: Values): Promise<number> {
  const domain = asDomainId(v.domain ?? '');
  const stratum = (v.stratum ?? 'realistic') as Stratum;
  if (!STRATA.includes(stratum)) throw new Error(`unknown --stratum ${stratum}`);
  const n = int(v.n, 'n');
  const seed = v.seed ?? '';
  if (!seed) throw new Error('--seed is required (the idea order is seeded)');
  const families = v.families.split(',').map((f) => f.trim()) as IdeationFamily[];
  const { deps, ollamaModel } = await llm(v);
  const per = Math.ceil(n / families.length);
  const byFamily: Partial<Record<IdeationFamily, Awaited<ReturnType<typeof ideate>>['ideas']>> = {};
  const raw: Record<string, string> = {};
  for (const family of families) {
    const r = await ideate({
      domain,
      stratum,
      n: per,
      family,
      model: v.model,
      ...(ollamaModel ? { ollamaModel } : {}),
      ...(deps ? { deps } : {}),
    });
    byFamily[family] = r.ideas;
    raw[family] = r.raw;
    console.log(`ideation ${domain}/${stratum} ${family}: ${r.ideas.length} ideas`);
  }
  const ordered = orderIdeas(domain, stratum, byFamily, seed);
  const file = ideasFile(v, domain, stratum);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && !v.force)
    throw new Error(`${file} exists (ideas are logged once; --force to replace)`);
  writeFileSync(
    `${file.replace(/\.jsonl$/, '')}.raw.json`,
    `${JSON.stringify({ seed, families, raw }, null, 2)}\n`,
  );
  writeFileSync(
    file,
    ordered
      .map((i) => JSON.stringify(i))
      .join('\n')
      .concat('\n'),
  );
  console.log(`wrote ${ordered.length} ideas in idea-index order -> ${file}`);
  return 0;
}

async function runDrifts(v: Values, stratum: Stratum): Promise<number> {
  const domainObj = domainOf(v);
  const domain = asDomainId(domainObj.id);
  const { deps, ollamaModel } = await llm(v);
  const repoDir = resolve(v['repo-dir'] ?? domainObj.repo.dir());
  const base = v.ref ?? BLIND_BASE[domain];
  let ideas: Idea[];
  if (v['dry-run']) {
    // One dev idea, ideated and implemented through the real pipeline.
    const r = await ideate({
      domain,
      stratum,
      n: 1,
      family: 'opus',
      model: v.model,
      ...(ollamaModel ? { ollamaModel } : {}),
      ...(deps ? { deps } : {}),
    });
    ideas = orderIdeas(domain, stratum, { opus: r.ideas.slice(0, 1) }, v.seed ?? 'dry-run');
  } else {
    if (!v.ideas) throw new Error('--ideas <file.jsonl> (or --dry-run) is required');
    ideas = readFileSync(resolve(v.ideas), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Idea)
      .filter((i) => i.domain === domain && i.stratum === stratum);
  }
  if (v.limit !== undefined) ideas = ideas.slice(0, int(v.limit, 'limit'));
  const repo = blindRepo(v);
  const ctx: DriftContext = {
    domain,
    repoDir,
    blindRepo: repo,
    model: v.model,
    base,
    logDir: resolve(v['log-dir'] ?? join(repo, 'transcripts')),
    ...(v['export-root'] ? { exportRoot: resolve(v['export-root']) } : {}),
    bash: repoBash(v, repoDir, base),
    ...(deps ? { deps } : {}),
  };
  const concurrency = v.concurrency
    ? int(v.concurrency, 'concurrency')
    : v.throughput
      ? concurrencyFromThroughput(resolve(v.throughput))
      : 1;
  const quotas = v['dry-run'] ? { [stratum]: { n: 1 } } : DEFAULT_QUOTAS;
  const report = await runA1({
    ctx,
    ideas,
    concurrency,
    ceiling: {
      ...(v['ceiling-usd'] ? { usd: Number(v['ceiling-usd']) } : {}),
      ...(v['ceiling-sessions'] ? { sessions: int(v['ceiling-sessions'], 'ceiling-sessions') } : {}),
    },
    quotas,
    raterModel: v['rater-model'],
    skipRating: v['no-rating'],
    validate: (pkgFile, opts) =>
      validateDrift({
        pkgFile,
        domain: domainObj,
        repoDir,
        requireRefB: opts.requireRefB,
        log: (l) => console.log(`  ${l}`),
      }),
    log: (l) => console.log(l),
  });
  console.log(`kept ${report.kept.length}: ${report.kept.join(', ')}`);
  for (const id of report.kept) console.log(`package: ${join(repo, 'drifts', `${id}.json`)}`);
  for (const [cell, c] of Object.entries(report.cells))
    if (c.shortfall || c.s12Shortfall)
      console.log(`shortfall ${cell}: ${c.shortfall} drifts, ${c.s12Shortfall} S12`);
  return 0;
}

/** Builds one export without a session (for inspection and the export acceptance checks). */
async function runExport(v: Values): Promise<number> {
  const kind = v['export-kind'] as ExportKind;
  if (!EXPORT_KINDS.includes(kind))
    throw new Error(`--export-kind must be one of ${EXPORT_KINDS.join(', ')}`);
  const domainObj = domainOf(v);
  const domain = asDomainId(domainObj.id);
  const repoDir = resolve(v['repo-dir'] ?? domainObj.repo.dir());
  const ref = v.ref ?? BLIND_BASE[domain];
  let files: ReturnType<typeof docsSources>;
  if (kind === 'catalog') {
    const b = catalogBriefName(domain);
    files = [
      ...docsSources(domain),
      textSource('BRIEF.md', readFileSync(briefPath(b), 'utf8'), briefPath(b)),
    ];
  } else if (kind === 'contract-author' || kind === 'contract-llm') {
    const protocol: ContractProtocol = kind === 'contract-llm' ? 'llm' : defaultProtocol(domain);
    files = (
      await contractInputs(
        {
          domain: domainObj,
          protocol,
          ...(v.seed !== undefined ? { seed: int(v.seed, 'seed') } : { seed: 1 }),
        },
        { domain: domainObj, catalog: 'original', repoDir },
      )
    ).files;
  } else if (kind === 'fixer' || kind === 'rater') {
    if (!v.pkg) throw new Error(`--export-kind ${kind} needs --pkg <driftpkg.json>`);
    files =
      kind === 'fixer' ? fixerExportFiles(repoDir, resolve(v.pkg), ref) : raterExportFiles(resolve(v.pkg));
  } else {
    const stratum: Stratum = kind === 'drift' ? 'realistic' : kind;
    const idea: Idea = {
      ideaId: `${domain}-${stratum}-export`,
      ideaIndex: 0,
      domain,
      stratum,
      family: 'opus',
      title: 'Export check',
      description: 'Placeholder idea for an export-only build.',
    };
    files = driftExportFiles(
      { domain, repoDir, blindRepo: blindRepo(v), model: v.model, logDir: '', base: ref },
      idea,
    );
  }
  const exp = buildExport({
    kind,
    label: `${domain}-${ref.replace(/[^\w.-]+/g, '_')}`,
    domain,
    files,
    ...(v['export-root'] ? { root: resolve(v['export-root']) } : {}),
  });
  console.log(
    v.json
      ? JSON.stringify(
          {
            dir: exp.dir,
            manifest: exp.manifestPath,
            manifestSha256: exp.manifestSha256,
            files: exp.manifest.files.length,
            excluded: exp.manifest.excluded,
          },
          null,
          2,
        )
      : `export ${kind}: ${exp.dir}\nmanifest: ${exp.manifestPath} (sha256 ${exp.manifestSha256})\nfiles: ${exp.manifest.files.length}, excluded: ${exp.manifest.excluded.map((e) => `${e.path} (${e.reason})`).join(', ') || 'none'}`,
  );
  return 0;
}

const command: CliCommandModule = {
  name: 'author',
  describe: 'blind authoring: catalog, contracts, ideas, drifts (A0/A1/A2), exports, check-no-bounds',
  async run(argv) {
    let v: Values;
    try {
      v = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }).values;
    } catch (e) {
      console.error(`${(e as Error).message}\n${USAGE}`);
      return 2;
    }
    try {
      if (v['check-no-bounds']) return await runCheckNoBounds(v);
      switch (v.kind) {
        case 'contract':
          return await runContract(v);
        case 'catalog':
          return await runCatalog(v);
        case 'ideas':
          return await runIdeas(v);
        case 'drift':
          return await runDrifts(v, 'realistic');
        case 'evasive':
        case 'benign':
          return await runDrifts(v, v.kind);
        case 'export':
          return await runExport(v);
        default:
          console.error(USAGE);
          return 2;
      }
    } catch (e) {
      console.error(`author: ${(e as Error).message}`);
      return 1;
    }
  },
};

export default command;
