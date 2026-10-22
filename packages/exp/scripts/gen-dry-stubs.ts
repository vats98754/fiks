// Generates packages/exp/fixtures/dry/*.json: the SAFE stub-runner scripts `pnpm exp --dry` passes
// as --agent-stub (WORKSTREAMS RUN, round 5/6). No LLM is involved.
//   D1, D3, D4, D5   packages/cli/test/oracles/D<n>.patch applied to shop-mcp seed-v1 (never the
//                    shop-mcp fix commits)
//   D2               a P1 clamp (PLAN 5.4): price clamped into the contract range [20, 2000]
//   DEV-X1, noop     no edit
//   TRK-DEV-1        DOM2's ref A (packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1/refA.patch)
//   repro-agent      one new test under test/ that loads .alerts/<id>.json through test/fiks/run.ts
//
// Each patch hunk becomes one Edit step (oldString = context + removed lines, newString = context +
// added lines). --check regenerates in memory and exits 1 if any fixture differs.
//
//   pnpm tsx packages/exp/scripts/gen-dry-stubs.ts [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const OUT = join(ROOT, 'packages/exp/fixtures/dry');

export interface EditStep {
  op: 'edit';
  path: string;
  oldString: string;
  newString: string;
}

/** Unified diff -> one edit step per hunk (paths without the a/ b/ prefixes). */
export function patchToEdits(patch: string): EditStep[] {
  const steps: EditStep[] = [];
  let path: string | null = null;
  let oldL: string[] | null = null;
  let newL: string[] | null = null;
  const flush = () => {
    if (path && oldL && newL)
      steps.push({ op: 'edit', path, oldString: oldL.join('\n'), newString: newL.join('\n') });
    oldL = null;
    newL = null;
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      path = null;
    } else if (line.startsWith('+++ ')) {
      path = line.slice(4).replace(/^b\//, '');
    } else if (line.startsWith('--- ') || line.startsWith('index ')) {
      // header
    } else if (line.startsWith('@@')) {
      flush();
      oldL = [];
      newL = [];
    } else if (oldL && newL) {
      if (line.startsWith(' ')) {
        oldL.push(line.slice(1));
        newL.push(line.slice(1));
      } else if (line.startsWith('-')) oldL.push(line.slice(1));
      else if (line.startsWith('+')) newL.push(line.slice(1));
      else if (line === '\\ No newline at end of file') {
        // ignore
      } else if (line === '') {
        // trailing newline of the patch file
      }
    }
  }
  flush();
  return steps;
}

const summary = (what: string) =>
  `Subject: dry stub (${what})\nScripted stub edit for pnpm exp --dry; no LLM.`;

export const REPRO_AGENT_TEST = `import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { replayRecording } from './fiks/run.ts';

// Dry-run REPRO-AGENT stub: loads the alert's recording from .alerts/<id>.json through the
// repository's replay helper (never inlined) and asserts the call no longer violates its contract.
const alerts = new URL('../.alerts/', import.meta.url);
const file = readdirSync(alerts).filter((f) => f.endsWith('.json')).sort()[0] ?? '';

test('the alerted call keeps its contract', async () => {
  const rec = JSON.parse(readFileSync(new URL(file, alerts), 'utf8'));
  const r = await replayRecording(rec);
  expect(r.evaluation.violations.map((v) => v.propertyId)).toEqual([]);
});
`;

export function buildStubs(): Record<string, unknown> {
  const oracle = (n: number) => readFileSync(join(ROOT, `packages/cli/test/oracles/D${n}.patch`), 'utf8');
  const fromPatch = (patch: string, what: string) => ({ steps: patchToEdits(patch), summary: summary(what) });
  return {
    'D1.json': fromPatch(oracle(1), 'D1 oracle patch on seed-v1'),
    'D2.json': {
      steps: [
        {
          op: 'edit',
          path: 'src/tools/get_product.ts',
          oldString: '    price: p.price ?? null,',
          newString: '    price: Math.min(Math.max(p.price ?? 20, 20), 2000),',
        },
      ],
      summary: summary('D2 P1 clamp to the contract range'),
    },
    'D3.json': fromPatch(oracle(3), 'D3 oracle patch on seed-v1'),
    'D4.json': fromPatch(oracle(4), 'D4 oracle patch on seed-v1'),
    'D5.json': fromPatch(oracle(5), 'D5 oracle patch on seed-v1'),
    'DEV-X1.json': { steps: [], summary: summary('DEV-X1 no-op') },
    'TRK-DEV-1.json': fromPatch(
      readFileSync(join(ROOT, 'packages/vendor-tracker/fixtures/driftpkgs/TRK-DEV-1/refA.patch'), 'utf8'),
      'TRK-DEV-1 ref A',
    ),
    'noop.json': { steps: [], summary: summary('no-op for drifts without a stub') },
    'repro-agent.json': {
      steps: [{ op: 'newTest', path: 'test/repro-agent.test.ts', content: REPRO_AGENT_TEST }],
      summary: summary('REPRO-AGENT test loading .alerts/<id>.json'),
    },
  };
}

export const serialize = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`;

function main(argv: string[]): number {
  const check = argv.includes('--check');
  let bad = 0;
  for (const [name, body] of Object.entries(buildStubs())) {
    const file = join(OUT, name);
    const want = serialize(body);
    if (check) {
      let have = '';
      try {
        have = readFileSync(file, 'utf8');
      } catch {
        have = '';
      }
      if (have !== want) {
        console.error(`differs: ${file}`);
        bad++;
      }
    } else writeFileSync(file, want);
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
