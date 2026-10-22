// Shared setup of ARMS's container tests: Docker, the sandbox images (shop-mcp, tracker-mcp), the
// test-only fiks-tools image of HEAD, and a runArm wrapper that runs every arm in a real
// per-attempt container (DockerArmSandbox) with a spy on everything sent into it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InjectorRule, RunKey, TraceFormat } from '@fiks/interfaces';
import type { RunnerJob, StubScript } from '@fiks/repair';
import { buildRepoImage } from '@fiks/sandbox';
import { stubAgent } from '../../src/agent.ts';
import type { ArmsArmName } from '../../src/arms.ts';
import { runArm } from '../../src/attempt.ts';
import { resolveDomain } from '../../src/domains.ts';
import { defaultContractsPath } from '../../src/iv.ts';
import { findRule } from '../../src/rules.ts';
import { DockerArmSandbox, type SandboxCall } from '../../src/sandbox.ts';
import { sidecarPathFor } from '../../src/sidecar.ts';
import { type LoadedTrace, loadFrozenTrace, traceDomain, traceProfile } from '../../src/trace.ts';
import { repoOf, TRACKER_STUB_CONTRACTS } from './fixtures.ts';
import { testToolsImage } from './tools-image.ts';

export const dockerReady = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const repoImages = new Map<string, Promise<string>>();
export function repoImage(domain: string): Promise<string> {
  let p = repoImages.get(domain);
  if (!p) {
    p = buildRepoImage({ repo: repoOf(domain) }).then((i) => i.digest);
    repoImages.set(domain, p);
  }
  return p;
}

export const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'arms-ct-')));

export interface ContainerRun {
  name: ArmsArmName;
  trace: string;
  sidecar?: string;
  base: string;
  script: StubScript;
  outDir: string;
  experiment?: string;
  traceFormat?: TraceFormat;
  issue?: { title: string; body: string };
  calls?: SandboxCall[];
  jobs?: { job: RunnerJob; session: number }[];
  keepCheckout?: boolean;
}

export async function runInContainer(r: ContainerRun) {
  const loaded: LoadedTrace = loadFrozenTrace(r.trace);
  const domainId = traceDomain(loaded.trace);
  const domain = await resolveDomain(domainId);
  const profile = traceProfile(loaded.trace, domainId);
  const rule: InjectorRule | undefined = profile.ruleId ? findRule(profile) : undefined;
  if (profile.ruleId && !rule) throw new Error(`no rule ${profile.ruleId}`);
  const contractsFile =
    domainId === 'tracker' ? TRACKER_STUB_CONTRACTS : defaultContractsPath(domainId, domain);
  const runKey: RunKey = {
    experiment: r.experiment ?? 'test',
    arm: r.name,
    model: 'stub',
    domain: domainId,
    drift: loaded.trace.id,
    attempt: 1,
  };
  const [image, tools] = await Promise.all([repoImage(domainId), testToolsImage()]);
  return runArm({
    name: r.name,
    runKey,
    domain,
    repoDir: repoOf(domainId),
    base: r.base,
    trace: loaded,
    issue: r.issue,
    profile,
    rule,
    contracts: readFileSync(contractsFile, 'utf8'),
    sidecar: readFileSync(r.sidecar ?? sidecarPathFor(r.trace), 'utf8'),
    traceFormat: r.traceFormat ?? 'raw',
    model: 'stub',
    agent: stubAgent(r.script),
    outDir: r.outDir,
    fiksCommit: tools.commit,
    keepCheckout: r.keepCheckout,
    onJob: (job, session) => r.jobs?.push({ job, session }),
    sandbox: (worktree) =>
      DockerArmSandbox.create({
        worktree,
        image,
        toolsImage: tools.digest,
        toolsPurpose: 'test',
        onCall: (c) => r.calls?.push(c),
        egressLog: join(r.outDir, 'egress.jsonl'),
      }),
  });
}

export const readJsonl = <T = Record<string, unknown>>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
