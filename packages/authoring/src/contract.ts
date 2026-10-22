// A0(b) contract authoring (PLAN 8.1, 5.1, 6.1 B-LLMC): one isolated session per contract file.
// Protocol `tracker` / `shop-blind`: export = the domain's docs/** + calls/ (30 v1 calls on the
// original catalog). Protocol `llm` (B-LLMC, per seed): export = tool descriptions + 20 S-dev
// records. The output is validated (schema + VOCAB's evaluator on every export call) before it is
// written to the reserved path with an AUTHORING log; an invalid output writes nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type ContractFile, type EvalResult, evaluate, findContract, type JsonSchema } from '@fiks/contracts';
import type { CallRecord, Domain } from '@fiks/interfaces';
import type { LlmDeps } from '@fiks/llm';
import { readBrief } from './briefs.ts';
import { contractFileErrors } from './contract-schema.ts';
import { type BuiltExport, buildExport, type SourceFile, sha256, textSource } from './export.ts';
import {
  authorView,
  type ChainOptions,
  type Probe,
  type RecordedCall,
  recordRows,
  replayWithProbes,
  selectRows,
  type ToolInfo,
} from './record.ts';
import { seededRng, shuffle } from './rng.ts';
import { type BashSandbox, runAuthorSession } from './session.ts';
import { asDomainId, docsSources } from './sources.ts';

export type ContractProtocol = 'tracker' | 'shop-blind' | 'llm';
export const CONTRACT_AUTHOR_CALLS = 30;
export const LLM_SDEV_CALLS = 20;
/** The fixed selection seed of the 30 contract-author calls (recorded in the AUTHORING log). */
export const CONTRACT_CALLS_SEED = 'contract-author-v1';

export function defaultProtocol(domain: string): ContractProtocol {
  return domain === 'tracker' ? 'tracker' : 'shop-blind';
}

/** Reserved output paths, relative to the out-root (PLAN 7.1 run outputs). */
export function contractOutputPaths(domain: string, protocol: ContractProtocol, seed?: number) {
  const dir = 'packages/contracts/contracts';
  if (protocol === 'llm') {
    if (seed === undefined) throw new Error('--protocol llm needs --seed <n>');
    return {
      contract: `${dir}/llm-authored/${domain}-seed${seed}.contracts.json`,
      log: `${dir}/llm-authored/AUTHORING-${domain}-seed${seed}.md`,
    };
  }
  if (protocol === 'tracker') {
    if (domain !== 'tracker') throw new Error(`--protocol tracker is for --domain tracker (got ${domain})`);
    return { contract: `${dir}/tracker-mcp.contracts.json`, log: `${dir}/AUTHORING-tracker.md` };
  }
  if (domain !== 'shop') throw new Error(`--protocol shop-blind is for --domain shop (got ${domain})`);
  return { contract: `${dir}/shop-blind.contracts.json`, log: `${dir}/AUTHORING-shop-blind.md` };
}

export const serverName = (domain: Domain) => domain.repo.slug.split('/').pop() as string;

export interface ContractEvaluation {
  calls: number;
  verdicts: Record<string, number>;
  evaluatorErrors: { call: number; error: string }[];
  violations: { call: number; tool: string; propertyId: string; message: string }[];
  replayMismatches: number;
}

/** Runs VOCAB's evaluator on every call (with the probe the proxy would have run). */
export function evaluateCalls(
  file: ContractFile,
  calls: RecordedCall[],
  tools: ToolInfo[],
  probes: (Probe | undefined)[] = [],
): ContractEvaluation {
  const schemas = new Map(tools.map((t) => [t.name, t.outputSchema as JsonSchema | undefined]));
  const out: ContractEvaluation = {
    calls: calls.length,
    verdicts: {},
    evaluatorErrors: [],
    violations: [],
    replayMismatches: 0,
  };
  calls.forEach((c, i) => {
    let r: EvalResult;
    try {
      const probe = probes[i];
      const schema = schemas.get(c.tool);
      r = evaluate(findContract(file, c.tool), {
        args: c.args,
        result: c.output,
        now: new Date(c.capturedAt),
        upstream: c.upstream,
        ...(schema ? { declaredOutputSchema: schema } : {}),
        ...(probe ? { probe } : {}),
      });
    } catch (e) {
      out.evaluatorErrors.push({ call: i, error: (e as Error).message });
      return;
    }
    out.verdicts[r.verdict] = (out.verdicts[r.verdict] ?? 0) + 1;
    for (const v of r.violations)
      out.violations.push({ call: i, tool: c.tool, propertyId: v.propertyId, message: v.message });
  });
  return out;
}

const pad = (n: number) => String(n).padStart(3, '0');

function fromCallRecord(r: CallRecord): RecordedCall {
  return {
    tool: r.tool,
    args: r.args,
    output: r.output,
    upstream: r.upstream.map((x, i) => ({ seq: i, startedAt: r.capturedAt, durationMs: 0, ...x })),
    capturedAt: r.capturedAt,
  };
}

export interface ContractAuthorOptions {
  domain: Domain;
  protocol: ContractProtocol;
  seed?: number;
  /** Prefix of the reserved output paths (default the repo root). */
  outRoot: string;
  model: string;
  exportRoot?: string;
  /** Transcripts and tool logs (default `<outRoot>/paper/results/raw/A0/<label>`). */
  logDir?: string;
  /** The MCP server checkout to record against (default the domain's clone). */
  repoDir?: string;
  /** llm protocol: S-dev CallRecords (JSONL, from the A0 S-dev record); default: record them here. */
  sdevRecords?: string;
  bash?: (exportDir: string) => BashSandbox | undefined;
  deps?: LlmDeps;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Overwrite an existing output (frozen artifacts are refused by default). */
  force?: boolean;
  log?: (line: string) => void;
}

export interface ContractAuthorResult {
  ok: boolean;
  errors: string[];
  contractPath?: string;
  logPath?: string;
  export: BuiltExport;
  evaluation?: ContractEvaluation;
  transcriptPath: string;
  rejectedPath?: string;
}

export interface ContractInputs {
  files: SourceFile[];
  calls: RecordedCall[];
  tools: ToolInfo[];
  selection: string;
}

/** The export files of a contract-author session and the calls behind them. */
export async function contractInputs(
  o: Pick<ContractAuthorOptions, 'domain' | 'protocol' | 'seed' | 'sdevRecords'>,
  chain: ChainOptions,
): Promise<ContractInputs> {
  const domainId = asDomainId(o.domain.id);
  let calls: RecordedCall[];
  let tools: ToolInfo[];
  let selection: string;
  const files: SourceFile[] = [];
  if (o.protocol === 'llm') {
    const seed = o.seed as number;
    if (o.sdevRecords) {
      const all = readFileSync(o.sdevRecords, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as CallRecord)
        .filter((r) => r.domain === domainId && r.drift === null && r.mutant === null);
      const pick = shuffle(all, seededRng(seed, `llm-sdev:${domainId}`)).slice(0, LLM_SDEV_CALLS);
      if (pick.length < LLM_SDEV_CALLS)
        throw new Error(`${o.sdevRecords}: only ${pick.length} ${domainId} S-dev records`);
      calls = pick.map(fromCallRecord);
      tools = (await recordRows(chain, [])).tools;
      selection = `${LLM_SDEV_CALLS} of ${all.length} S-dev records from ${o.sdevRecords}, seeded shuffle (seed ${seed})`;
    } else {
      const rows = selectRows(o.domain, LLM_SDEV_CALLS, seed, `llm-sdev:${domainId}`);
      ({ calls, tools } = await recordRows(chain, rows));
      selection = `${LLM_SDEV_CALLS} original-catalog enumeration rows recorded here (--monitor none form), round-robin per tool, seed ${seed}`;
    }
    files.push(textSource('tools/tools.json', `${JSON.stringify({ tools }, null, 2)}\n`));
  } else {
    const rows = selectRows(
      o.domain,
      CONTRACT_AUTHOR_CALLS,
      CONTRACT_CALLS_SEED,
      `contract-author:${domainId}`,
    );
    ({ calls, tools } = await recordRows(chain, rows));
    selection = `${CONTRACT_AUTHOR_CALLS} original-catalog enumeration rows, round-robin per tool, seed ${CONTRACT_CALLS_SEED}`;
    files.push(...docsSources(domainId));
  }
  for (const [i, c] of calls.entries())
    files.push(
      textSource(`calls/${pad(i + 1)}-${c.tool}.json`, `${JSON.stringify(authorView(c), null, 2)}\n`),
    );
  return { files, calls, tools, selection };
}

export async function authorContract(o: ContractAuthorOptions): Promise<ContractAuthorResult> {
  const say = o.log ?? (() => {});
  const domainId = asDomainId(o.domain.id);
  const paths = contractOutputPaths(domainId, o.protocol, o.seed);
  const contractPath = join(o.outRoot, paths.contract);
  const logPath = join(o.outRoot, paths.log);
  if (!o.force && (existsSync(contractPath) || existsSync(logPath)))
    throw new Error(`${contractPath} already exists (frozen output; pass --force to replace it)`);
  const label = `contract-${domainId}-${o.protocol}${o.protocol === 'llm' ? `-seed${o.seed}` : ''}`;
  const chain: ChainOptions = {
    domain: o.domain,
    catalog: 'original',
    ...(o.repoDir ? { repoDir: o.repoDir } : {}),
  };

  // 1. Inputs, recorded on the original catalog under the frozen clock, with no contract evaluated.
  const { files, calls, tools, selection } = await contractInputs(o, chain);
  say(`${label}: ${calls.length} calls recorded (${selection})`);

  // 2. The export (outside ~/fiks; manifest beside it).
  const exp = buildExport({
    kind: o.protocol === 'llm' ? 'contract-llm' : 'contract-author',
    label,
    domain: domainId,
    files,
    ...(o.exportRoot ? { root: o.exportRoot } : {}),
  });
  if (exp.manifest.excluded.length) {
    throw new Error(
      `${label}: the export would leave out ${exp.manifest.excluded.map((e) => `${e.path} (${e.reason})`).join(', ')}`,
    );
  }
  say(
    `${label}: export ${exp.dir} (${exp.manifest.files.length} files, manifest sha256 ${exp.manifestSha256})`,
  );

  // 3. The session.
  const brief = readBrief(o.protocol === 'llm' ? 'contract-llm' : 'contract-author');
  const prompt = `${brief}\n${readBrief('contract-format')}\nThe server is \`${serverName(o.domain)}\`; use it as "server" and \`${domainId}.<tool>\` as each tool entry's id.`;
  const logDir = o.logDir ?? join(o.outRoot, 'paper/results/raw/A0', label);
  const bash = o.bash?.(exp.dir);
  const run = await runAuthorSession({
    kind: exp.manifest.kind,
    label,
    exportDir: exp.dir,
    prompt,
    model: o.model,
    tools: bash
      ? ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash']
      : ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    budget: { maxTurns: o.maxTurns ?? 60, maxBudgetUsd: o.maxBudgetUsd ?? 10 },
    ...(bash ? { bash } : {}),
    logDir,
    ...(o.deps ? { deps: o.deps } : {}),
  });

  // 4. Validation: schema, then VOCAB's evaluator on every export call.
  const errors: string[] = [];
  if (!run.session.ok)
    errors.push(
      `session ${run.session.outcome}: ${run.session.modelError ?? run.session.failure?.message ?? ''}`,
    );
  if (!run.audit.ok) errors.push(`transcript audit failed: ${JSON.stringify(run.audit)}`);
  const outFile = join(exp.dir, 'out/contracts.json');
  let text = '';
  let file: ContractFile | undefined;
  if (!existsSync(outFile)) errors.push('the session wrote no out/contracts.json');
  else {
    text = readFileSync(outFile, 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      errors.push(`out/contracts.json is not JSON: ${(e as Error).message}`);
    }
    if (raw !== undefined) {
      const errs = contractFileErrors(raw, {
        server: serverName(o.domain),
        tools: tools.map((t) => t.name),
        requireTools: [...new Set(calls.map((c) => c.tool))].sort(),
      });
      errors.push(...errs.map((e) => `schema: ${e}`));
      if (!errs.length) file = raw as ContractFile;
    }
  }
  let evaluation: ContractEvaluation | undefined;
  if (file) {
    const needsProbes = file.contracts.some((c) => (c.postconditions?.length ?? 0) > 0);
    let probes: (Probe | undefined)[] = [];
    let replayMismatches = 0;
    if (needsProbes) {
      // Read-after-write needs the probe the proxy runs live: replay the calls in order on a fresh
      // chain (same catalog and clock) and probe after each write.
      const r = await replayWithProbes(chain, calls, file);
      probes = r.probes;
      replayMismatches = r.sameOutput.filter((s) => !s).length;
    }
    evaluation = { ...evaluateCalls(file, calls, tools, probes), replayMismatches };
    if (evaluation.evaluatorErrors.length)
      errors.push(`evaluator errors: ${JSON.stringify(evaluation.evaluatorErrors)}`);
  }
  const result: ContractAuthorResult = {
    ok: errors.length === 0,
    errors,
    export: exp,
    transcriptPath: run.transcriptPath,
    ...(evaluation ? { evaluation } : {}),
  };
  if (!result.ok) {
    const rejectedPath = join(logDir, `${label}.rejected.json`);
    mkdirSync(dirname(rejectedPath), { recursive: true });
    writeFileSync(rejectedPath, `${JSON.stringify({ errors, output: text || null }, null, 2)}\n`);
    return { ...result, rejectedPath };
  }

  // 5. Write the contract and its AUTHORING log at the reserved paths.
  mkdirSync(dirname(contractPath), { recursive: true });
  writeFileSync(contractPath, text.endsWith('\n') ? text : `${text}\n`);
  const meta = {
    domain: domainId,
    protocol: o.protocol,
    seed: o.seed ?? null,
    model: o.model,
    sessionId: run.session.sessionId ?? null,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    export: {
      dir: exp.dir,
      kind: exp.manifest.kind,
      files: exp.manifest.files.length,
      manifestSha256: exp.manifestSha256,
      contentSha256: exp.manifest.contentSha256,
    },
    calls: { count: calls.length, selection },
    transcript: { path: run.transcriptPath, sha256: run.transcriptSha256 },
    toolLog: { path: run.toolLogPath, sha256: sha256(readFileSync(run.toolLogPath)) },
    audit: run.audit,
    session: { outcome: run.session.outcome, turns: run.session.turns, costUsd: run.session.costUsd },
    contract: { path: paths.contract, sha256: sha256(readFileSync(contractPath)) },
    validation: {
      schema: 'valid',
      evaluator: {
        calls: evaluation?.calls,
        evaluatorErrors: evaluation?.evaluatorErrors.length,
        verdicts: evaluation?.verdicts,
        violations: evaluation?.violations.length,
        replayMismatches: evaluation?.replayMismatches,
      },
    },
  };
  const md = [
    `# AUTHORING log: ${paths.contract.split('/').pop()}`,
    '',
    `Written by \`pnpm fiks author --kind contract --domain ${domainId} --protocol ${o.protocol}${o.protocol === 'llm' ? ` --seed ${o.seed}` : ''}\` (stream BLIND, PLAN 8.1 A0(b)).`,
    '',
    `- Model: ${o.model}`,
    `- Seed: ${o.seed ?? 'n/a'}`,
    `- Session id: ${meta.sessionId ?? 'n/a'}`,
    `- Start: ${run.startedAt}; end: ${run.endedAt}`,
    `- Export manifest sha256: ${exp.manifestSha256} (content ${exp.manifest.contentSha256}, ${exp.manifest.files.length} files)`,
    `- Transcript sha256: ${run.transcriptSha256}`,
    `- Calls: ${selection}`,
    `- Session isolation: settingSources [] = ${run.audit.settingSourcesEmpty}; cwd = export = ${run.audit.cwdIsExport}; web tools excluded = ${run.audit.webToolsExcluded}; forbidden reads ${run.audit.forbiddenReads.length}; sentinel hits ${run.audit.sentinelHits.length}`,
    `- Validation: schema valid; evaluator ran on ${evaluation?.calls} calls with ${evaluation?.evaluatorErrors.length} errors; verdicts ${JSON.stringify(evaluation?.verdicts)}; ${evaluation?.violations.length} violations on the export's own calls`,
    '',
    '```json',
    JSON.stringify(meta, null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(logPath, md);
  return { ...result, contractPath, logPath };
}
