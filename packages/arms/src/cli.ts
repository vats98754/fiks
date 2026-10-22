// `pnpm fiks arm` (packages/cli/src/commands/arm.ts calls armMain): one attempt of one comparator arm.
//
//   pnpm fiks arm --name L1|L1-noIV|L1p|COMP|COMP-norep|COMP-plain|ISSUE-TEXT|REPRO-AGENT
//     --trace <frozen trace> (ISSUE-TEXT: --issue <file>) --base <local ref> --run-key <exp/arm/model/domain/drift/attempt>
//     --ci local --no-pr [--domain <id>] [--trace-format raw|strict] [--agent-stub <script.json>]
//     [--sidecar <trace>.iv.json] [--contracts <file>] [--rule <rule.json>] [--profile <json|file>]
//     [--image <repo image>] [--tools-image <fiks-tools image>] [--repo <dir>] [--out <dir>] [--json]
//
// --domain defaults to the frozen trace's domain; the Domain supplies the edit guard
// (allowedEditPaths), the prompt hints and the server. Experiments: --ci local and --no-pr only
// (no PR is ever opened, no `gh` call is made). The fiks-tools image comes from --tools-image or
// FIKS_TOOLS_IMAGE; --tools-image-test-only accepts a test-only image (build-tools.ts --apply-fragments).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type Domain,
  formatRunKey,
  type InjectorRule,
  parseRunKey,
  type RerecordProfile,
} from '@fiks/interfaces';
import { loadStubScript, parseTraceFormat } from '@fiks/repair';
import { buildRepoImage } from '@fiks/sandbox';
import { type AgentProvider, sdkAgent, stubAgent } from './agent.ts';
import { armSpec, isArmsArm } from './arms.ts';
import { runArm } from './attempt.ts';
import { resolveDomain } from './domains.ts';
import { defaultContractsPath } from './iv.ts';
import type { IssueText } from './prompts.ts';
import { FIKS_ROOT, findRule } from './rules.ts';
import { DockerArmSandbox } from './sandbox.ts';
import { loadSidecar, sidecarPathFor } from './sidecar.ts';
import { type LoadedTrace, loadFrozenTrace, traceDomain, traceProfile } from './trace.ts';

export const ARM_USAGE =
  'arm --name <ARM> --trace <frozen> (ISSUE-TEXT: --issue <file>) --base <local ref> --run-key <exp/arm/model/domain/drift/attempt> --ci local --no-pr [--domain <id>] [--trace-format raw|strict] [--agent-stub <script.json>] [--sidecar <file>] [--contracts <file>] [--rule <file>] [--profile <json|file>] [--image <ref>] [--tools-image <ref>] [--repo <dir>] [--out <dir>] [--json]';

export function parseIssue(file: string): IssueText {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const j = JSON.parse(text) as { title?: unknown; body?: unknown };
    if (typeof j.title !== 'string' || typeof j.body !== 'string')
      throw new Error(`${file}: want {title, body}`);
    return { title: j.title, body: j.body };
  }
  const [first = '', ...rest] = text.split('\n');
  return { title: first.replace(/^#+\s*/, ''), body: rest.join('\n') };
}

const readJsonArg = (raw: string): unknown =>
  JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8'));

export interface ArmMainDeps {
  /** Overrides the agent (tests). */
  agent?: AgentProvider;
  log?: (s: string) => void;
  out?: (s: string) => void;
}

export async function armMain(argv: string[], deps: ArmMainDeps = {}): Promise<number> {
  const say = deps.out ?? ((s: string) => process.stdout.write(s));
  const err = (s: string) => process.stderr.write(s);
  const parse = (a: string[]) =>
    parseArgs({
      args: a,
      options: {
        name: { type: 'string' },
        trace: { type: 'string' },
        issue: { type: 'string' },
        base: { type: 'string' },
        domain: { type: 'string' },
        'run-key': { type: 'string' },
        ci: { type: 'string', default: 'local' },
        'no-pr': { type: 'boolean', default: true },
        pr: { type: 'boolean', default: false },
        'trace-format': { type: 'string', default: 'raw' },
        'agent-stub': { type: 'string' },
        model: { type: 'string' },
        sidecar: { type: 'string' },
        contracts: { type: 'string' },
        rule: { type: 'string' },
        profile: { type: 'string' },
        image: { type: 'string' },
        'tools-image': { type: 'string' },
        'tools-image-test-only': { type: 'boolean', default: false },
        repo: { type: 'string' },
        out: { type: 'string' },
        'keep-checkout': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }).values;
  let v: ReturnType<typeof parse>;
  try {
    v = parse(argv);
  } catch (e) {
    err(`fiks arm: ${e instanceof Error ? e.message : String(e)}\nusage: fiks ${ARM_USAGE}\n`);
    return 2;
  }
  if (v.help) {
    say(`usage: fiks ${ARM_USAGE}\n`);
    return 0;
  }
  const usage = (m: string) => {
    err(`fiks arm: ${m}\nusage: fiks ${ARM_USAGE}\n`);
    return 2;
  };
  if (!v.name || !isArmsArm(v.name))
    return usage(`--name must be one of the comparator arms (got ${v.name ?? 'none'})`);
  const spec = armSpec(v.name);
  if (v.ci !== 'local') return usage('experiments run with --ci local (hermetic CI in the sandbox image)');
  if (v.pr) return usage('fiks arm never opens a PR (--no-pr is the only mode)');
  if (!v.base) return usage('--base <local ref> is required');
  if (!v['run-key']) return usage('--run-key is required');
  let runKey: ReturnType<typeof parseRunKey>;
  try {
    runKey = parseRunKey(v['run-key']);
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  if (runKey.arm !== spec.name)
    return usage(`the run key's arm (${runKey.arm}) must be --name (${spec.name})`);
  let traceFormat: ReturnType<typeof parseTraceFormat>;
  try {
    traceFormat = parseTraceFormat(v['trace-format']);
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  if (spec.evidence === 'issue' && !v.issue) return usage(`${spec.name} needs --issue <file>`);
  if (spec.evidence !== 'issue' && !v.trace) return usage(`${spec.name} needs --trace <frozen trace>`);

  let trace: LoadedTrace | undefined;
  try {
    trace = v.trace ? loadFrozenTrace(resolve(v.trace)) : undefined;
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  const domainId = v.domain ?? (trace ? traceDomain(trace.trace) : undefined);
  if (!domainId) return usage('--domain is required without --trace');
  if (runKey.domain !== domainId)
    return usage(`the run key's domain (${runKey.domain}) must be the domain (${domainId})`);
  let domain: Domain;
  try {
    domain = await resolveDomain(domainId);
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }

  let profile: RerecordProfile;
  try {
    if (v.profile) {
      const p = readJsonArg(v.profile) as RerecordProfile;
      profile = { domain: p.domain, base: p.base, ruleId: p.ruleId ?? null, ruleHash: p.ruleHash ?? null };
    } else if (trace) profile = traceProfile(trace.trace, domainId);
    else return usage(`${spec.name} without --trace needs --profile (the drift's re-record profile)`);
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  if (profile.domain !== domainId)
    return usage(`the profile's domain (${profile.domain}) must be ${domainId}`);
  let rule: InjectorRule | undefined;
  if (profile.ruleId) {
    rule = v.rule ? (readJsonArg(v.rule) as InjectorRule) : findRule(profile);
    if (!rule)
      return usage(`no injector rule ${profile.ruleId} (hash ${profile.ruleHash}) found; pass --rule <file>`);
    if (rule.id !== profile.ruleId || rule.hash !== profile.ruleHash)
      return usage(
        `--rule ${rule.id}/${rule.hash} does not match the profile ${profile.ruleId}/${profile.ruleHash}`,
      );
  }

  let contracts: string | undefined;
  let sidecar: string | undefined;
  if (spec.ivPlacement !== 'none') {
    try {
      contracts = readFileSync(
        v.contracts ? resolve(v.contracts) : defaultContractsPath(domainId, domain),
        'utf8',
      );
    } catch (e) {
      return usage(`frozen contracts: ${e instanceof Error ? e.message : String(e)}`);
    }
    const side = v.sidecar ? resolve(v.sidecar) : trace ? sidecarPathFor(trace.path) : undefined;
    if (!side || !existsSync(side))
      return usage(
        `IV sidecar required: ${spec.name} runs fiks-iv in experiment mode; pass --sidecar <trace>.iv.json`,
      );
    try {
      loadSidecar(side);
    } catch (e) {
      return usage(e instanceof Error ? e.message : String(e));
    }
    sidecar = readFileSync(side, 'utf8');
  }

  const toolsImage = v['tools-image'] ?? process.env.FIKS_TOOLS_IMAGE;
  if (!toolsImage)
    return usage(
      '--tools-image <fiks-tools image> (or FIKS_TOOLS_IMAGE) is required: every check runs in the sandbox',
    );
  const repoDir = resolve(v.repo ?? domain.repo.dir());
  if (!existsSync(join(repoDir, '.git'))) return usage(`no clone of ${domain.repo.slug} at ${repoDir}`);
  let issue: IssueText | undefined;
  try {
    issue = v.issue ? parseIssue(resolve(v.issue)) : undefined;
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  let agent: AgentProvider;
  try {
    agent =
      deps.agent ?? (v['agent-stub'] ? stubAgent(loadStubScript(resolve(v['agent-stub']))) : sdkAgent());
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  const model = v.model ?? runKey.model;
  if (v.model && v.model !== runKey.model)
    return usage(`--model ${v.model} differs from the run key's model ${runKey.model}`);
  const fiksDir = process.env.FIKS_DIR ?? join(FIKS_ROOT, '.fiks');
  const outDir = resolve(v.out ?? join(fiksDir, 'arms', ...formatRunKey(runKey).split('/')));
  const image = v.image ?? (await buildRepoImage({ repo: repoDir })).digest;
  const fiksCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: FIKS_ROOT, encoding: 'utf8' }).trim();

  const r = await runArm({
    name: spec.name,
    runKey,
    domain,
    repoDir,
    base: v.base,
    trace,
    issue,
    profile,
    rule,
    contracts,
    sidecar,
    traceFormat,
    model,
    agent,
    outDir,
    fiksCommit,
    keepCheckout: v['keep-checkout'],
    log: deps.log ?? ((s) => err(`${s}\n`)),
    sandbox: (worktree) =>
      DockerArmSandbox.create({
        worktree,
        image,
        toolsImage,
        toolsPurpose: v['tools-image-test-only'] ? 'test' : 'run',
        egressLog: join(outDir, 'egress.jsonl'),
      }),
  });
  if (v.json)
    say(
      `${JSON.stringify({ outDir: r.outDir, stop: r.stop, attempt: r.attempt, reproTests: r.reproTests })}\n`,
    );
  else {
    say(`${spec.name}: ${r.stop}\nresults: ${r.outDir}\n`);
    if (r.attempt)
      say(
        `prExposed=${r.attempt.prExposed} ciFinal=${r.attempt.ciFinal} issueValidation=${r.attempt.issueValidation} ivPlacement=${r.attempt.ivPlacement} head=${r.attempt.headSha ?? '-'}\n`,
      );
    for (const t of r.reproTests ?? [])
      say(
        `F round ${t.round}: ${t.path || '(no test)'} fOnBase=${t.fOnBase}${t.isFirst ? ' first' : ''}${t.isFinal ? ' final' : ''}\n`,
      );
  }
  return 0;
}
