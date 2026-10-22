// Regenerates the generated parts of the HOLD dev DriftPackages (packages/heldout/fixtures/dev):
// hidden tests and their renamed-id variants (expected outputs from vendor v1 ground truth under
// the shop frozen clock) and each manifest. Hand-written parts (refB.patch, refA.patch for DEV-X1,
// generators.ts, pmut/) are read, never written. `--check` exits 1 when a file would change.
//
//   pnpm tsx packages/heldout/src/dev/build.ts [--check]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRule } from '@fiks/injector';
import type { DriftPackage } from '@fiks/interfaces';
import { createVendor, SHOP_FROZEN_CLOCK, shopTruth } from '@fiks/vendor-api';
import { type HiddenStep, hiddenTestSource } from './hidden-template.ts';
import { DEV_SPECS, type DevDriftSpec, SHOP_RENAME, type SpecFile, type StepRef } from './specs.ts';

export const HELDOUT_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const DEV_DIR = join(HELDOUT_DIR, 'fixtures/dev');
const FIKS_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const INJECTOR_RULES = join(FIKS_ROOT, 'packages/injector/fixtures/rules');

/** Formats text with fiks's own Biome (the fiks repo lints the fixtures). */
export function formatText(fileName: string, text: string): string {
  return execFileSync(
    join(FIKS_ROOT, 'node_modules/.bin/biome'),
    ['format', '--vcs-enabled=false', `--stdin-file-path=${fileName}`],
    { cwd: FIKS_ROOT, input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

const isRef = (v: unknown): v is StepRef =>
  typeof v === 'object' && v !== null && '$step' in (v as Record<string, unknown>);

/** Applies `{pattern, replace}` regex rules to every string in a JSON value. */
export function renameJson<T>(value: T, rules: readonly { pattern: string; replace: string }[]): T {
  let text = JSON.stringify(value);
  for (const r of rules) text = text.replace(new RegExp(r.pattern, 'g'), r.replace);
  return JSON.parse(text) as T;
}

/** Steps with expected outputs from vendor v1 ground truth (one fresh vendor per upstream). */
export async function expectedSteps(file: SpecFile): Promise<HiddenStep[]> {
  const now = new Date(SHOP_FROZEN_CLOCK);
  const vendors = {
    drifted: createVendor({ version: 'v1', now: () => now }),
    v1: createVendor({ version: 'v1', now: () => now }),
  };
  const urls = {
    drifted: await vendors.drifted.listen(),
    v1: await vendors.v1.listen(),
  };
  try {
    const out: HiddenStep[] = [];
    for (const s of file.steps) {
      const args = Object.fromEntries(
        Object.entries(s.args).map(([k, v]) => {
          if (!isRef(v)) return [k, v];
          const from = out[v.$step]?.expected as Record<string, unknown> | undefined;
          if (!from || from[v.field] === undefined)
            throw new Error(`${file.file}: unresolved ${JSON.stringify(v)}`);
          return [k, from[v.field]];
        }),
      );
      if (s.tool === 'create_order') {
        // The write's effect on the ground-truth vendor (a persisted order).
        const r = await fetch(`${urls[s.upstream]}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': `hold-${out.length}` },
          body: JSON.stringify({ items: args.items }),
        });
        await r.text();
      }
      const t = shopTruth({ tool: s.tool, args }, vendors[s.upstream].state);
      out.push({ tool: s.tool, args, upstream: s.upstream, inputValid: t.inputValid, expected: t.expected });
    }
    return out;
  } finally {
    await vendors.drifted.close();
    await vendors.v1.close();
  }
}

export interface BuiltFile {
  path: string;
  bytes: string;
}

export async function buildDrift(spec: DevDriftSpec): Promise<BuiltFile[]> {
  const dir = join(DEV_DIR, spec.id);
  const files: BuiltFile[] = [];
  const hidden: string[] = [];
  for (const f of spec.files) {
    const steps = await expectedSteps(f);
    const base = { driftId: spec.id, file: f.file, title: f.title, manifestation: describe(f.manifestation) };
    const p = `hidden/${f.file}`;
    hidden.push(p);
    files.push({ path: join(dir, p), bytes: formatText(f.file, hiddenTestSource({ ...base, steps })) });
    const renamed = renameJson(steps, SHOP_RENAME.forward);
    files.push({
      path: join(dir, 'hidden-renamed', f.file),
      bytes: formatText(f.file, hiddenTestSource({ ...base, steps: renamed }, { renamed: true })),
    });
  }
  files.push({
    path: join(dir, 'hidden-renamed', 'rename.json'),
    bytes: formatText('rename.json', `${JSON.stringify(SHOP_RENAME, null, 2)}\n`),
  });
  const rule = readRule(join(INJECTOR_RULES, spec.rule));
  const manifest: DriftPackage = {
    id: spec.id,
    domain: spec.domain,
    base: spec.base,
    stratum: 'dev',
    ideationFamily: spec.ideationFamily,
    authorSession: 'HOLD-builder-r1',
    injectorRule: { path: `../../../../injector/fixtures/rules/${spec.rule}`, hash: rule.hash },
    hiddenTests: hidden,
    refA: spec.refA,
    refB: 'refB.patch',
    renamedIdVariant: 'hidden-renamed',
    generators: ['generators.ts'],
    ...(spec.changelog ? { changelog: spec.changelog } : {}),
  };
  files.push({
    path: join(dir, 'manifest.json'),
    bytes: formatText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`),
  });
  for (const hand of ['refB.patch', 'generators.ts', ...(spec.refA.startsWith('../') ? [] : [spec.refA])]) {
    if (!existsSync(join(dir, hand))) throw new Error(`${spec.id}: hand-written ${hand} is missing`);
  }
  return files;
}

function describe(m: SpecFile['manifestation']): string {
  return {
    'other-input': 'other inputs to the drifted tool',
    'other-tool': 'another tool flow over the drifted field',
    'v1-preserved': 'v1 behaviour preserved',
  }[m];
}

export async function buildAll(opts: { check?: boolean } = {}): Promise<{ changed: string[] }> {
  const changed: string[] = [];
  for (const spec of DEV_SPECS) {
    for (const f of await buildDrift(spec)) {
      const old = existsSync(f.path) ? readFileSync(f.path, 'utf8') : undefined;
      if (old === f.bytes) continue;
      changed.push(f.path.slice(HELDOUT_DIR.length));
      if (!opts.check) {
        mkdirSync(dirname(f.path), { recursive: true });
        writeFileSync(f.path, f.bytes);
      }
    }
  }
  return { changed };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  buildAll({ check }).then(
    ({ changed }) => {
      for (const c of changed) console.log(`${check ? 'would change' : 'wrote'} ${c}`);
      console.log(`${basename(DEV_DIR)}: ${changed.length} file(s) ${check ? 'differ' : 'written'}`);
      process.exitCode = check && changed.length ? 1 : 0;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.stack : String(e));
      process.exitCode = 2;
    },
  );
}
