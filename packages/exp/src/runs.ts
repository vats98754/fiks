// Run definitions T0, A0, A1, R0-R11 (PLAN 8.1) as config. Block runs (R1, R3, R4, R6, R7, R8)
// schedule (drift, model, attempt-index) blocks that hold every arm of the phase; command runs are
// an ordered list of argv templates. Templates for commands owned by other streams follow their
// WORKSTREAMS deliverables; INTEG checks each against the merged CLIs.

import { join } from 'node:path';
import type { TraceFormat } from '@fiks/interfaces';
import type { ArmName } from './argv.ts';
import { ALL_MODELS, CONFIRMATORY_ARMS, MODEL, RUNG_CUT_ORDER } from './steps.ts';

export interface Phase {
  name: string;
  arms: ArmName[];
  models: string[];
  /** Attempts per (arm, model, drift); blocks are breadth-first over the attempt index. */
  attempts: number;
  /** R7: every arm runs once per trace format; the format goes into the run key's experiment. */
  traceFormats?: TraceFormat[];
  /** 'main' = the run's inputs (dev split or manifest); 'dev' = always the dev split. */
  inputs: 'main' | 'dev';
  /** Phase is skipped under --dev (it needs test-split inputs, e.g. R7 carriers). */
  skipInDev?: boolean;
}

export type Gate = 'confirmatory-lock' | 'cap-headroom' | 'rba' | 'approval';

interface RunBase {
  id: string;
  title: string;
  /** Containment preflight (PLAN P1, round 6): R1 and R3-R8, including their --dry variants. */
  preflight: boolean;
  gates: Gate[];
}

export interface BlockRun extends RunBase {
  kind: 'blocks';
  /** Inputs: the dev split, or a manifest (default path relative to the out root). */
  inputs: 'dev' | 'manifest';
  defaultManifest?: string;
  phases: Phase[];
  /** Added to every block under --dry, so the dry run exercises every arm (INTEG). */
  dryExtraArms?: ArmName[];
  /** Arms/models/attempts come from the K1 step (R3, R4). */
  k1?: 'R3' | 'R4';
}

export interface CommandStep {
  key: string;
  argv: string[];
}

export interface CommandCtx {
  outRoot: string;
  runDir: string;
  fiks: string[];
  tsx: string[];
  dry: boolean;
  toolsImage: string | null;
}

export interface CommandRun extends RunBase {
  kind: 'commands';
  steps(ctx: CommandCtx): CommandStep[];
}

export type RunDef = BlockRun | CommandRun;

const DOMAINS = ['shop', 'tracker'];

export const RUNS: RunDef[] = [
  {
    id: 'T0',
    kind: 'commands',
    title: 'Throughput probe (LLMR): 1, 2, 4 concurrent sessions and ollama tokens/s',
    preflight: false,
    gates: [],
    steps: (c) => [
      {
        key: 'probe',
        argv: [
          ...c.tsx,
          'packages/llm/src/probe.ts',
          '--concurrency',
          '1,2,4',
          '--ollama',
          '--out',
          join(c.outRoot, 'throughput.json'),
          ...(c.dry ? ['--dry'] : []),
        ],
      },
    ],
  },
  {
    id: 'A0',
    kind: 'commands',
    title: 'Catalog extension, contracts (tracker, shop-blind, LLM x 3 seeds), S-dev record, seed-tracker-v1',
    preflight: false,
    gates: [],
    steps: (c) => [
      ...DOMAINS.map((d) => ({
        key: `catalog/${d}`,
        argv: [...c.fiks, 'author', '--kind', 'catalog', '--domain', d, '--batches', '30'],
      })),
      {
        key: 'contract/tracker',
        argv: [...c.fiks, 'author', '--kind', 'contract', '--domain', 'tracker', '--protocol', 'tracker'],
      },
      {
        key: 'contract/shop-blind',
        argv: [...c.fiks, 'author', '--kind', 'contract', '--domain', 'shop', '--protocol', 'shop-blind'],
      },
      ...DOMAINS.flatMap((d) =>
        [1, 2, 3].map((seed) => ({
          key: `contract/llm/${d}/${seed}`,
          argv: [
            ...c.fiks,
            'author',
            '--kind',
            'contract',
            '--domain',
            d,
            '--protocol',
            'llm',
            '--seed',
            String(seed),
          ],
        })),
      ),
      ...DOMAINS.flatMap((d) => [
        {
          key: `s-dev/${d}/enumerate`,
          argv: [
            ...c.fiks,
            'enumerate',
            '--domain',
            d,
            '--frame',
            '--catalog',
            'original',
            '--seed',
            'A0-sdev',
            '--out',
            join(c.runDir, `s-dev-${d}.jsonl`),
          ],
        },
        {
          key: `s-dev/${d}/record`,
          argv: [
            ...c.fiks,
            'record',
            '--domain',
            d,
            '--frame',
            '--monitor',
            'contracts',
            '--in',
            join(c.runDir, `s-dev-${d}.jsonl`),
            '--out',
            join(c.runDir, `s-dev-${d}`),
          ],
        },
      ]),
      { key: 'seed-tag/tracker', argv: [...c.fiks, 'seed-tag', '--domain', 'tracker'] },
    ],
  },
  {
    id: 'A1',
    kind: 'commands',
    title:
      'Blind authoring (BLIND A1 runner; concurrency from throughput.json; ceiling $1,000 / 520 sessions)',
    preflight: false,
    gates: [],
    steps: (c) => [
      {
        key: 'a1',
        argv: [
          ...c.fiks,
          'author',
          '--a1',
          '--throughput',
          join(c.outRoot, 'throughput.json'),
          '--ceiling-usd',
          '1000',
          '--ceiling-sessions',
          '520',
          '--out-root',
          c.runDir,
        ],
      },
    ],
  },
  {
    id: 'R0',
    kind: 'commands',
    title:
      'Infra validation (no LLM): drift validity, keep rule, split, enumerations, parity, CI agreement, SAST pilot',
    preflight: false,
    gates: [],
    steps: (c) => [
      {
        key: 'validate-drift',
        argv: [...c.fiks, 'validate-drift', '--all', '--out', join(c.runDir, 'validity')],
      },
      { key: 'split', argv: [...c.fiks, 'split', '--out', join(c.runDir, 'split.json')] },
      {
        key: 'agreement',
        argv: [...c.tsx, 'packages/sandbox/src/agreement.ts', '--out', join(c.runDir, 'agreement.json')],
      },
    ],
  },
  {
    id: 'R1',
    kind: 'blocks',
    title: 'Pilot, dev only: FIKS/L1/COMP + REPRO-AGENT x 3 models x 2 attempts',
    preflight: true,
    gates: [],
    inputs: 'dev',
    phases: [
      {
        name: 'pilot',
        arms: [...CONFIRMATORY_ARMS, 'REPRO-AGENT'],
        models: [...ALL_MODELS],
        attempts: 2,
        inputs: 'main',
      },
    ],
    dryExtraArms: ['L1-noIV', 'L1p', 'COMP-norep', 'COMP-plain'],
  },
  {
    id: 'R2',
    kind: 'commands',
    title: 'Detection, test split: frame replay --per-element, record + freeze-trace, detectors, judges',
    preflight: false,
    gates: [],
    steps: (c) => [
      {
        key: 'detect-eval',
        argv: [
          ...c.fiks,
          'detect-eval',
          '--detectors',
          'all',
          '--inputs',
          join(c.outRoot, 'R2', 'records'),
          '--out',
          join(c.outRoot, 'detect'),
        ],
      },
    ],
  },
  {
    id: 'P-pool',
    kind: 'commands',
    title: 'Primary patch pool for detected test drifts (HOLD)',
    preflight: false,
    gates: [],
    steps: (c) => [{ key: 'pool', argv: [...c.fiks, 'pool', '--primary', '--out', c.runDir] }],
  },
  {
    id: 'R3',
    kind: 'blocks',
    title: 'REPRO-AGENT on detected test drifts (F check with feedback)',
    preflight: true,
    gates: [],
    inputs: 'manifest',
    defaultManifest: 'R2/eligible.json',
    k1: 'R3',
    phases: [{ name: 'repro', arms: ['REPRO-AGENT'], models: [...ALL_MODELS], attempts: 2, inputs: 'main' }],
  },
  {
    id: 'R4',
    kind: 'blocks',
    title: 'Main repair: FIKS, L1, COMP (confirmatory blocks first), then the exploratory rungs (Opus x 3)',
    preflight: true,
    gates: [],
    inputs: 'manifest',
    defaultManifest: 'R2/eligible.json',
    k1: 'R4',
    phases: [
      {
        name: 'confirmatory',
        arms: [...CONFIRMATORY_ARMS],
        models: [...ALL_MODELS],
        attempts: 4,
        inputs: 'main',
      },
      { name: 'rungs', arms: [...RUNG_CUT_ORDER], models: [MODEL.opus], attempts: 3, inputs: 'main' },
    ],
  },
  {
    id: 'R5',
    kind: 'commands',
    title: 'Grading of every final head of a block run (HOLD grade; --from <run>, default R4)',
    preflight: false,
    gates: [],
    // Built from the source run's registry at run time (see main.ts gradeSteps).
    steps: () => [],
  },
  {
    id: 'R6',
    kind: 'blocks',
    title: 'Benign: FIKS-current, FIKS+CU, COMP (Opus x 3)',
    preflight: true,
    gates: [],
    inputs: 'manifest',
    defaultManifest: 'R2/benign-eligible.json',
    phases: [
      {
        name: 'benign',
        arms: ['FIKS', 'FIKS+CU', 'COMP'],
        models: [MODEL.opus],
        attempts: 3,
        inputs: 'main',
      },
    ],
  },
  {
    id: 'R7',
    kind: 'blocks',
    title: 'Security: payloads x carriers x {raw, strict} on the hardened loop; strict-vs-raw utility on dev',
    preflight: true,
    gates: [],
    inputs: 'manifest',
    defaultManifest: 'R7/carriers.json',
    phases: [
      {
        name: 'hardened',
        arms: ['FIKS'],
        models: [MODEL.opus],
        attempts: 1,
        traceFormats: ['raw', 'strict'],
        inputs: 'main',
        skipInDev: true,
      },
      {
        name: 'utility',
        arms: ['FIKS', 'L1'],
        models: [MODEL.opus],
        attempts: 2,
        traceFormats: ['raw', 'strict'],
        inputs: 'dev',
      },
    ],
  },
  {
    id: 'R8',
    kind: 'blocks',
    title: 'Real bugs: FIKS vs COMP vs ISSUE-TEXT through RBA (Opus x 5)',
    preflight: true,
    gates: ['rba'],
    inputs: 'manifest',
    defaultManifest: 'R8/inputs.json',
    phases: [
      {
        name: 'realbugs',
        arms: ['FIKS', 'COMP', 'ISSUE-TEXT'],
        models: [MODEL.opus],
        attempts: 5,
        inputs: 'main',
      },
    ],
  },
  {
    id: 'R9',
    kind: 'commands',
    title: 'Held-out traffic: 2 domains x 20 tasks x agents x 3 trials (ollama share per the 8.2 rule)',
    preflight: false,
    gates: [],
    // Agents depend on the K1 ollama rule (see main.ts trafficSteps).
    steps: () => [],
  },
  {
    id: 'R10',
    kind: 'commands',
    title: 'Optional E11 (receipts vs no monitor), after CP2, only if caps remain; never projected',
    preflight: false,
    gates: ['confirmatory-lock', 'cap-headroom'],
    steps: (c) => [
      {
        key: 'e11',
        argv: [...c.fiks, 'bench', '--model', MODEL.sonnet, '--k', '4', '--out', join(c.runDir, 'bench')],
      },
    ],
  },
  {
    id: 'R11',
    kind: 'commands',
    title: 'D10 showcase: product-mode PRs on one seeded-drawn detected test drift per domain (never merged)',
    preflight: false,
    gates: ['confirmatory-lock', 'approval'],
    // Built from the F9 eligible list at run time (see main.ts showcaseSteps).
    steps: () => [],
  },
];

export const RUN_IDS = RUNS.map((r) => r.id);

export function getRun(id: string): RunDef {
  const r = RUNS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown run ${JSON.stringify(id)} (known: ${RUN_IDS.join(', ')})`);
  return r;
}

/** R10 units for the cap-headroom gate: about 2,000 Sonnet calls (PLAN 8.1). */
export const R10_UNITS = 2000 * 0.5;
