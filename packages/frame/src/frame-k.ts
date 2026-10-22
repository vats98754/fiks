// FrameSpec from the pre-F4b frame records (PLAN 3.1, 5.7; Appendix `FrameSpec`). Uses only the
// records (outputs, upstream exchanges, truth() comparison, Domain.originEntity/entityClass labels),
// path resolution (./paths.ts), fpCapability and propertyFamily. No contract is evaluated: which
// properties *apply* to an input is decided by path resolution, never by a verdict.
import {
  type ContractFile,
  type EndpointMeta,
  type FpCapability,
  fpCapability,
  type Invariant,
  propertyFamily,
  type ReadAfterWrite,
  type ToolContract,
} from '@fiks/contracts';
import type { FrameCell, FrameSpec, PaginatedEndpoint } from '@fiks/interfaces';
import { labelAt } from './attribution.ts';
import { h1Design } from './binom.ts';
import { TOOL_ENDPOINTS } from './endpoints.ts';
import { canonicalJson, sha256Hex } from './hash.ts';
import { isClean } from './label.ts';
import { presentAt, resolvePath } from './paths.ts';
import type { DetCallRecord, ExtendedEntity } from './records.ts';

/** Primary-id property families per domain (`unique` on them is truth-entailed). */
export const ID_FAMILIES: Record<string, string[]> = { shop: ['id'], tracker: ['id', 'key'] };

/** EndpointMeta for a tool: paginated iff its v1 endpoint is one of the domain's paginated ones. */
export function endpointMetaFor(
  domain: string,
  tool: string,
  paginated: readonly PaginatedEndpoint[],
): EndpointMeta {
  const ep = TOOL_ENDPOINTS[domain]?.[tool];
  const isPaged =
    ep !== undefined &&
    paginated.some(
      (p) => p.method.toUpperCase() === ep.method.toUpperCase() && new RegExp(p.pathPattern).test(ep.path),
    );
  return { paginated: isPaged, idFamilies: ID_FAMILIES[domain] ?? ['id'] };
}

/** The path a property's family is taken from (as in VOCAB's fpCapabilityTable). */
function familyPath(p: Invariant | ReadAfterWrite): string {
  if ('probeTool' in p) return p.id;
  switch (p.kind) {
    case 'countMatchesTotal':
      return p.itemsPath;
    case 'crossField':
      return p.left;
    case 'pageComplete':
      return p.upstreamCursorPath;
    default:
      return p.path;
  }
}

type Pair = DetCallRecord['upstream'][number];

function upstreamJson(pairs: readonly Pair[]): { path: string; body: unknown }[] {
  const out: { path: string; body: unknown }[] = [];
  for (const x of pairs) {
    if (x.response.status < 200 || x.response.status > 299) continue;
    try {
      out.push({ path: x.request.url.split('?')[0] ?? '', body: JSON.parse(x.response.body) });
    } catch {
      // not JSON
    }
  }
  return out;
}

/**
 * The concrete output paths a property would read on this input, by path resolution only
 * (empty = the property does not apply). Collection-level properties return their collection path.
 */
export function appliedPaths(inv: Invariant, data: unknown, upstream: readonly Pair[]): string[] {
  switch (inv.kind) {
    case 'range':
      return presentAt(data, inv.path)
        .filter((r) => typeof r.value === 'number')
        .map((r) => r.at);
    case 'notNull':
    case 'nonEmpty':
    case 'freshness':
      return resolvePath(data, inv.path).map((r) => r.at);
    case 'enum':
      return resolvePath(data, inv.path)
        .filter((r) => r.value !== null && r.value !== undefined)
        .map((r) => r.at);
    case 'unique':
      return presentAt(data, inv.path).map((r) => r.at);
    case 'countMatchesTotal': {
      const items = resolvePath(data, inv.itemsPath)[0]?.value;
      const total = resolvePath(data, inv.totalPath)[0]?.value;
      return Array.isArray(items) && typeof total === 'number' ? [inv.itemsPath] : [];
    }
    case 'crossField': {
      const objects = inv.path ? presentAt(data, inv.path) : [{ at: '', value: data }];
      return objects
        .filter(({ value }) => {
          const a = resolvePath(value, inv.left)[0]?.value;
          const b = resolvePath(value, inv.right)[0]?.value;
          return a !== undefined && a !== null && b !== undefined && b !== null;
        })
        .map(({ at }) => (at ? `${at}.${inv.left}` : inv.left));
    }
    case 'pageComplete':
      return upstreamJson(upstream).some((r) => presentAt(r.body, inv.upstreamCursorPath).length > 0)
        ? [inv.upstreamCursorPath]
        : [];
    case 'equalsUpstream':
      return resolvePath(data, inv.path).map((r) => r.at);
  }
}

export interface FrameDomainInput {
  id: string;
  contracts: ContractFile;
  paginatedEndpoints: readonly PaginatedEndpoint[];
  /** Every extended-catalog entity the frame vendor served (record manifest). */
  entities: readonly ExtendedEntity[];
}

export interface FrameKInput {
  domains: FrameDomainInput[];
  /** The frame CallRecords of every domain, in recording order. */
  records: readonly DetCallRecord[];
  /** sha256 of the hashed record set (enters F4b). */
  recordSetSha256: string;
  /** Catalog batches the N_E rule added (PLAN 3.1 rule 1). */
  topUpBatches?: number;
  /** Disabled properties to treat as applying (H1 re-enable sensitivity); default none. */
  reenable?: readonly string[];
}

export interface FrameKReport {
  spec: FrameSpec;
  /** Inputs dropped by the dedupe key (domain, tool, args, sha256(upstream responses)). */
  duplicates: string[];
  /** Deduped inputs where the base tool disagrees with truth() (excluded from Clean; reported). */
  notClean: { inputId: string; tool: string; mismatches: string[] }[];
  /** Clean inputs to which no FP-capable property applies. */
  ineligible: number;
  capability: Record<string, FpCapability>;
}

const isStructured = (r: DetCallRecord) =>
  !r.output.isError && r.output.structuredContent !== undefined && r.output.structuredContent !== null;

/** The dedupe key of PLAN 3.1: (domain, tool, args, sha256(upstream response)). */
export const frameDedupeKey = (r: DetCallRecord): string =>
  sha256Hex(
    canonicalJson([r.domain, r.tool, r.args, sha256Hex(r.upstream.map((x) => x.response.body).join('\n'))]),
  );

export function frameK(input: FrameKInput): FrameKReport {
  const byDomain = new Map(input.domains.map((d) => [d.id, d]));
  const capability: Record<string, FpCapability> = {};
  const families: Record<string, string> = {};
  const entailed = new Set<string>();
  const contractOf = new Map<string, ToolContract>();
  for (const d of input.domains) {
    for (const c of d.contracts.contracts) {
      contractOf.set(`${d.id}\u0000${c.tool}`, c);
      const meta = endpointMetaFor(d.id, c.tool, d.paginatedEndpoints);
      for (const p of [...c.invariants, ...(c.postconditions ?? [])]) {
        const id = `${c.id}/${p.id}`;
        const cap = fpCapability(p, meta);
        capability[id] = cap;
        if (cap === 'capable') families[id] = propertyFamily(familyPath(p));
        if (cap === 'entailed') entailed.add(id);
      }
      // The declared outputSchema check is not in the F2 table; a truthful output that breaks the
      // tool's own schema is a tool defect, so it is a sanity count like the entailed properties.
      entailed.add(`${c.id}/outputSchema`);
    }
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const notClean: FrameKReport['notClean'] = [];
  const eligibleInputs: string[] = [];
  const attribution: Record<string, Record<string, string>> = {};
  const cellInputs = new Map<string, Set<string>>();
  const attributed = new Set<string>();
  let nF = 0;
  let ineligible = 0;
  const reenable = new Set(input.reenable ?? []);

  for (const r of input.records) {
    if (!byDomain.has(r.domain)) continue;
    const key = frameDedupeKey(r);
    if (seen.has(key)) {
      duplicates.push(r.inputId);
      continue;
    }
    seen.add(key);
    nF++;
    if (!isClean(r.truth)) {
      notClean.push({ inputId: r.inputId, tool: r.tool, mismatches: r.truth.mismatches });
      continue;
    }
    const contract = contractOf.get(`${r.domain}\u0000${r.tool}`);
    if (!contract || !isStructured(r)) {
      ineligible++;
      continue;
    }
    const data = r.output.structuredContent;
    const paths: Record<string, string> = {};
    for (const inv of contract.invariants) {
      const id = `${contract.id}/${inv.id}`;
      if (capability[id] !== 'capable') continue;
      if (inv.disabled === true && !reenable.has(id)) continue;
      for (const at of appliedPaths(inv, data, r.upstream)) {
        const unit = labelAt(r.originUnit, at);
        paths[at] = unit;
        attributed.add(unit);
        const cell = `${contract.id}\u0000${id}\u0000${labelAt(r.entityClass, at)}`;
        const set = cellInputs.get(cell) ?? new Set<string>();
        cellInputs.set(cell, set);
        set.add(r.inputId);
      }
    }
    if (Object.keys(paths).length === 0) {
      ineligible++;
      continue;
    }
    eligibleInputs.push(r.inputId);
    attribution[r.inputId] = paths;
  }

  const entities = input.domains.flatMap((d) =>
    d.entities.map((e) => ({
      id: e.id,
      domain: d.id,
      authorBatch: e.authorBatch,
      eligible: attributed.has(e.id),
    })),
  );
  const NE = entities.filter((e) => e.eligible).length;
  const cells: FrameCell[] = [...cellInputs.entries()]
    .map(([k, set]) => {
      const [contract = '', property = '', cls = ''] = k.split('\u0000');
      return { contract, property, class: cls, nInputs: set.size };
    })
    .sort((a, b) =>
      a.contract === b.contract
        ? a.property === b.property
          ? a.class.localeCompare(b.class)
          : a.property.localeCompare(b.property)
        : a.contract.localeCompare(b.contract),
    );
  const design = h1Design(NE);
  const spec: FrameSpec = {
    domain: input.domains.map((d) => d.id),
    nF,
    eligibleInputs,
    entities,
    NE,
    attribution,
    families,
    cells,
    K: cells.length,
    entailedProps: [...entailed].sort(),
    neRule: { topUpBatches: input.topUpBatches ?? 0, underpowered: design.underpowered, m: design.m },
    crit: design.crit,
    power: design.power,
    hash: input.recordSetSha256,
  };
  return { spec, duplicates, notClean, ineligible, capability };
}
