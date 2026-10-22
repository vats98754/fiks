// A0(a) catalog extension (PLAN 3.1, 5.1, 8.1): independent batches of 25 entities, each written by
// a fresh session in a fresh catalog export (public docs + brief only). A batch never sees another
// batch's output: every session gets the same prompt and its own export copy. Entities get ids in
// the extended namespace (`px-…` / `TX-…`, disjoint from the original catalog) and their
// `authorBatch`. `--top-up` adds batches after the existing ones (before F4b).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LlmDeps } from '@fiks/llm';
import { validateExtended as validateShop } from '@fiks/vendor-api';
import { validateExtended as validateTracker } from '@fiks/vendor-tracker';
import { BATCH_SIZE, briefPath, catalogBriefName, readBrief } from './briefs.ts';
import { buildExport, sha256, textSource } from './export.ts';
import { runAuthorSession } from './session.ts';
import { type DomainId, docsSources } from './sources.ts';

/** Reserved extended-catalog paths (relative to the out-root). */
export const EXTENDED_PATHS: Record<DomainId, string> = {
  shop: 'packages/vendor-api/catalog/extended.json',
  tracker: 'packages/vendor-tracker/catalog/extended.json',
};

export const batchId = (n: number) => `b${String(n).padStart(3, '0')}`;
export const entityId = (d: DomainId, batch: number, i: number) =>
  d === 'shop'
    ? `px-b${String(batch).padStart(3, '0')}-${String(i).padStart(2, '0')}`
    : `TX-B${String(batch).padStart(3, '0')}-${String(i).padStart(2, '0')}`;
const idKey = (d: DomainId) => (d === 'shop' ? 'id' : 'key');

const ENTITY_FIELDS: Record<DomainId, string[]> = {
  shop: ['name', 'category', 'price', 'currency', 'stock'],
  tracker: [
    'title',
    'type',
    'state',
    'priority',
    'labels',
    'assignees',
    'reporter',
    'story_points',
    'created_at',
    'updated_at',
    'comments',
  ],
};

/** Structured-output schema of one batch (no id, no authorBatch: both are assigned here). */
export function batchSchema(d: DomainId): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const f of ENTITY_FIELDS[d]) props[f] = {};
  return {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: { type: 'object', properties: props, required: ENTITY_FIELDS[d] },
      },
    },
    required: ['entities'],
  };
}

function validateOne(d: DomainId, entity: Record<string, unknown>): Record<string, unknown> {
  const [v] = d === 'shop' ? validateShop([entity]) : validateTracker([entity]);
  return v as unknown as Record<string, unknown>;
}

export interface CatalogBatchLog {
  batch: string;
  sessionId: string | null;
  model: string;
  startedAt: string;
  endedAt: string;
  exportDir: string;
  exportManifestSha256: string;
  transcriptPath: string;
  transcriptSha256: string;
  audit: { ok: boolean; forbiddenReads: number; sentinelHits: number };
  outcome: string;
  proposed: number;
  kept: number;
  rejected: { index: number; error: string }[];
  costUsd: number;
}

export interface CatalogOptions {
  domain: DomainId;
  batches: number;
  topUp?: boolean;
  outRoot: string;
  model: string;
  exportRoot?: string;
  logDir?: string;
  deps?: LlmDeps;
  maxTurns?: number;
  maxBudgetUsd?: number;
  log?: (line: string) => void;
}

export interface CatalogResult {
  file: string;
  added: number;
  total: number;
  batches: CatalogBatchLog[];
  stoppedByCap: boolean;
}

export async function authorCatalog(o: CatalogOptions): Promise<CatalogResult> {
  const say = o.log ?? (() => {});
  if (!Number.isInteger(o.batches) || o.batches < 1) throw new Error('--batches must be a positive integer');
  const file = join(o.outRoot, EXTENDED_PATHS[o.domain]);
  const logFile = join(dirname(file), 'AUTHORING-catalog.jsonl');
  let existing: Record<string, unknown>[] = [];
  if (existsSync(file)) {
    if (!o.topUp) throw new Error(`${file} exists; only --top-up may add batches to it`);
    existing = (JSON.parse(readFileSync(file, 'utf8')) as { entities: Record<string, unknown>[] }).entities;
  } else if (o.topUp) throw new Error(`--top-up needs an existing extended catalog (${file})`);
  const used = existing.map((e) => Number(/^b(\d+)$/.exec(String(e.authorBatch))?.[1] ?? 0));
  const first = (used.length ? Math.max(...used) : 0) + 1;
  const brief = readBrief(catalogBriefName(o.domain));
  const schema = batchSchema(o.domain);
  const logDir = o.logDir ?? join(o.outRoot, 'paper/results/raw/A0', `catalog-${o.domain}`);
  const added: Record<string, unknown>[] = [];
  const logs: CatalogBatchLog[] = [];
  let stoppedByCap = false;
  for (let b = first; b < first + o.batches; b++) {
    const id = batchId(b);
    // A fresh export per batch: no file written by an earlier batch is visible.
    const exp = buildExport({
      kind: 'catalog',
      label: `${o.domain}-${id}`,
      domain: o.domain,
      files: [...docsSources(o.domain), textSource('BRIEF.md', brief, briefPath(catalogBriefName(o.domain)))],
      ...(o.exportRoot ? { root: o.exportRoot } : {}),
    });
    const run = await runAuthorSession({
      kind: 'catalog',
      label: `catalog-${o.domain}-${id}`,
      exportDir: exp.dir,
      prompt: brief,
      model: o.model,
      tools: ['Read', 'Glob', 'Grep'],
      budget: { maxTurns: o.maxTurns ?? 20, maxBudgetUsd: o.maxBudgetUsd ?? 3 },
      outputSchema: schema,
      logDir,
      ...(o.deps ? { deps: o.deps } : {}),
    });
    const proposed = (
      (run.session.structuredOutput as { entities?: unknown[] } | undefined)?.entities ?? []
    ).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e));
    const rejected: CatalogBatchLog['rejected'] = [];
    const kept: Record<string, unknown>[] = [];
    if (run.session.ok && run.audit.ok) {
      proposed.slice(0, BATCH_SIZE).forEach((e, i) => {
        const { id: _i, key: _k, authorBatch: _a, ...fields } = e;
        try {
          kept.push(
            validateOne(o.domain, {
              ...fields,
              [idKey(o.domain)]: entityId(o.domain, b, i + 1),
              authorBatch: id,
            }),
          );
        } catch (err) {
          rejected.push({ index: i, error: (err as Error).message });
        }
      });
      if (proposed.length > BATCH_SIZE)
        rejected.push({
          index: BATCH_SIZE,
          error: `${proposed.length - BATCH_SIZE} entities beyond the batch size dropped`,
        });
    }
    const entry: CatalogBatchLog = {
      batch: id,
      sessionId: run.session.sessionId ?? null,
      model: o.model,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      exportDir: exp.dir,
      exportManifestSha256: exp.manifestSha256,
      transcriptPath: run.transcriptPath,
      transcriptSha256: run.transcriptSha256,
      audit: {
        ok: run.audit.ok,
        forbiddenReads: run.audit.forbiddenReads.length,
        sentinelHits: run.audit.sentinelHits.length,
      },
      outcome: run.session.outcome,
      proposed: proposed.length,
      kept: kept.length,
      rejected,
      costUsd: run.session.costUsd,
    };
    logs.push(entry);
    say(`catalog ${o.domain} ${id}: ${run.session.outcome}, kept ${kept.length}/${proposed.length}`);
    if (run.session.outcome === 'cap') {
      // A cap stops the command; the batch is not counted (re-run with --top-up after the reset).
      stoppedByCap = true;
      break;
    }
    added.push(...kept);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(logFile, `${JSON.stringify(entry)}\n`, { flag: 'a' });
    // Written after every batch, so an interrupted run keeps what it has.
    writeFileSync(file, `${JSON.stringify({ entities: [...existing, ...added] }, null, 2)}\n`);
  }
  if (added.length || existing.length) {
    const all = [...existing, ...added];
    // The whole file must load with the vendor's own validator.
    if (o.domain === 'shop') validateShop(all);
    else validateTracker(all);
  }
  say(
    `catalog ${o.domain}: +${added.length} entities -> ${file} (sha256 ${existsSync(file) ? sha256(readFileSync(file)) : 'n/a'})`,
  );
  return { file, added: added.length, total: existing.length + added.length, batches: logs, stoppedByCap };
}
