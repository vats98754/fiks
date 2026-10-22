// Command-run steps built at run time from earlier run outputs: R2 (split -> per-drift record and
// freeze-trace, frame replay, detectors), R5 (grade every final head of a block run), R9 (traffic,
// ollama share per the K1 rule) and R11 (D10 showcase PRs).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gradeArgv, showcaseArgv } from './argv.ts';
import type { DriftInput } from './inputs.ts';
import { loadRegistry, outcomeRows } from './registry.ts';
import { seededShuffle } from './rng.ts';
import type { CommandCtx, CommandStep } from './runs.ts';

const DOMAINS = ['shop', 'tracker'];

export function r2Steps(c: CommandCtx, splitFile: string): CommandStep[] {
  if (!existsSync(splitFile)) throw new Error(`R2 needs the R0 split file: ${splitFile}`);
  const split = JSON.parse(readFileSync(splitFile, 'utf8')) as {
    test?: { id: string; domain: string; pkg: string }[];
    benign?: { id: string; domain: string; pkg: string }[];
  };
  const steps: CommandStep[] = [];
  const perDrift = (kind: 'drift' | 'benign', d: { id: string; domain: string; pkg: string }) => {
    const dir = join(c.runDir, kind, d.id);
    steps.push(
      {
        key: `${kind}/${d.id}/enumerate`,
        argv: [
          ...c.fiks,
          'enumerate',
          '--drift',
          d.pkg,
          '--seed',
          `R2-${d.id}`,
          '--out',
          join(dir, 'enum.jsonl'),
        ],
      },
      {
        key: `${kind}/${d.id}/record`,
        argv: [
          ...c.fiks,
          'record',
          '--domain',
          d.domain,
          `--${kind}`,
          d.pkg,
          '--in',
          join(dir, 'enum.jsonl'),
          '--out',
          join(dir, 'records'),
        ],
      },
      {
        key: `${kind}/${d.id}/freeze-trace`,
        argv: [
          ...c.fiks,
          'freeze-trace',
          '--records',
          join(dir, 'records'),
          '--out',
          join(dir, 'trace.json'),
        ],
      },
    );
  };
  for (const d of split.test ?? []) perDrift('drift', d);
  for (const d of split.benign ?? []) perDrift('benign', d);
  for (const d of DOMAINS) {
    steps.push({
      key: `frame/${d}/replay`,
      argv: [
        ...c.tsx,
        'packages/proxy/src/replay-cli.ts',
        '--in',
        join(c.outRoot, 'frame', d),
        '--out',
        join(c.runDir, `frame-${d}.verdicts.jsonl`),
        '--per-element',
        '--domain',
        d,
      ],
    });
  }
  steps.push({
    key: 'detect-eval',
    argv: [
      ...c.fiks,
      'detect-eval',
      '--detectors',
      'all',
      '--inputs',
      join(c.runDir, 'drift'),
      '--out',
      join(c.outRoot, 'detect'),
    ],
  });
  return steps;
}

/**
 * R5: one `fiks grade` per completed attempt of the source run. The final head is the attempt's
 * last captured candidate (AttemptRecord.candidateIds); attempts without one are listed as skipped.
 */
export function gradeSteps(
  c: CommandCtx,
  sourceRunDir: string,
): { steps: CommandStep[]; skipped: { runKey: string; reason: string }[] } {
  if (!c.toolsImage) throw new Error('R5 needs --tools-image <fiks-tools image> (HOLD grade)');
  const planFile = join(sourceRunDir, 'plan.json');
  if (!existsSync(planFile)) throw new Error(`no plan.json in ${sourceRunDir}`);
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as { inputs: DriftInput[] };
  const pkgOf = new Map(plan.inputs.map((d) => [d.id, d.gradePkg]));
  const steps: CommandStep[] = [];
  const skipped: { runKey: string; reason: string }[] = [];
  for (const row of outcomeRows(loadRegistry(join(sourceRunDir, 'registry.jsonl')))) {
    const drift = row.runKey.split('/')[4] as string;
    const pkg = pkgOf.get(drift);
    if (!pkg) {
      skipped.push({ runKey: row.runKey, reason: 'no grading package' });
      continue;
    }
    const attemptJson = findFile(join(sourceRunDir, row.dir), 'attempt.json');
    const ids = attemptJson
      ? ((JSON.parse(readFileSync(attemptJson, 'utf8')) as { candidateIds?: string[] }).candidateIds ?? [])
      : [];
    const last = ids[ids.length - 1];
    const diff = last && attemptJson ? join(attemptJson, '..', 'candidates', `${last}.diff`) : null;
    if (!diff || !existsSync(diff)) {
      skipped.push({ runKey: row.runKey, reason: 'no captured candidate (no final head diff)' });
      continue;
    }
    steps.push({
      key: `grade/${row.runKey}`,
      argv: gradeArgv(c.fiks, {
        pkg,
        patch: diff,
        toolsImage: c.toolsImage,
        out: join(c.runDir, 'grades', ...row.runKey.split('/')),
        runKey: row.runKey,
      }),
    });
  }
  return { steps, skipped };
}

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e === name) return p;
  }
  return null;
}

export function trafficSteps(c: CommandCtx, ollama: boolean): CommandStep[] {
  const agents = ['opus', 'sonnet', 'haiku', ...(ollama ? ['ollama'] : [])].join(',');
  return DOMAINS.map((d) => ({
    key: `traffic/${d}`,
    argv: [
      ...c.fiks,
      'traffic',
      '--domain',
      d,
      '--agents',
      agents,
      '--trials',
      '3',
      '--out',
      join(c.runDir, `traffic-${d}`),
    ],
  }));
}

/** R11 draw: one detected test drift per domain, seeded; ties to input order. */
export function showcaseDraw(eligible: DriftInput[], seed: string): DriftInput[] {
  const out: DriftInput[] = [];
  for (const d of DOMAINS) {
    const pool = eligible.filter((e) => e.domain === d);
    if (pool.length === 0) throw new Error(`R11: no detected test drift in domain ${d}`);
    out.push(seededShuffle(pool, seed, `R11|${d}`)[0] as DriftInput);
  }
  return out;
}

/**
 * R11 steps per drawn drift: create `showcase/<driftId>` at DriftPackage.base on the vats98754
 * repo (PLAN 8.0-3), then the product-mode repair (PR against that branch; never merged).
 */
export function showcaseSteps(
  c: CommandCtx,
  drawn: DriftInput[],
  repoDirOf: (domain: string) => string,
): CommandStep[] {
  return drawn.flatMap((d) => [
    {
      key: `showcase/${d.id}/branch`,
      argv: [
        'git',
        '-C',
        repoDirOf(d.domain),
        'push',
        'origin',
        `${d.base}^{commit}:refs/heads/showcase/${d.id}`,
      ],
    },
    { key: `showcase/${d.id}/repair`, argv: showcaseArgv(c.fiks, d) },
  ]);
}
