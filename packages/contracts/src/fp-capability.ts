// The pre-registered FP-capability table (paper/PLAN.md §3.1, frozen at F2). It is a fixed rule
// over invariant kinds, not a judgement per contract: a property is
//   - 'entailed' when a tool output that equals truth() can never violate it,
//   - 'capable' when a truthful output can still violate it (a false positive is possible),
//   - 'knownGoodOnly' when it is scoped to knownGoodInputs and so applies to no frame input.
// Not vendored into shop-mcp: only evaluate.ts and types.ts are.
import type { ContractFile, Invariant, ReadAfterWrite, ToolContract } from './types.ts';

export type FpCapability = 'entailed' | 'capable' | 'knownGoodOnly';

/** What the table needs to know about the endpoint behind a tool. */
export interface EndpointMeta {
  /** True when the base (v1) upstream paginates this tool's listing endpoint. */
  paginated: boolean;
  /**
   * Property families that are primary ids for this tool (default ['id']): `unique` on them is
   * entailed, on anything else it is FP-capable.
   */
  idFamilies?: string[];
}

/** Property family = the last non-index segment of a path (PLAN D12): `items[*].price` -> `price`. */
export function propertyFamily(path: string): string {
  const segs = path
    .split('.')
    .map((s) => s.replace(/\[(\*|\d+)\]/g, ''))
    .filter((s) => s !== '');
  return segs.at(-1) ?? path;
}

const isPostcondition = (p: Invariant | ReadAfterWrite): p is ReadAfterWrite => 'probeTool' in p;

export function fpCapability(property: Invariant | ReadAfterWrite, endpoint: EndpointMeta): FpCapability {
  // readAfterWrite and every postcondition: truth-entailed.
  if (isPostcondition(property)) return 'entailed';
  const inv = property;
  if ('onlyKnownGood' in inv && inv.onlyKnownGood === true) return 'knownGoodOnly';
  switch (inv.kind) {
    case 'equalsUpstream':
      return 'entailed';
    case 'countMatchesTotal':
      return endpoint.paginated ? 'capable' : 'entailed';
    case 'unique':
      return (endpoint.idFamilies ?? ['id']).includes(propertyFamily(inv.path)) ? 'entailed' : 'capable';
    case 'range':
    case 'freshness':
    case 'notNull':
    case 'nonEmpty':
    case 'enum':
    case 'crossField':
    case 'pageComplete':
      return 'capable';
  }
}

export interface FpCapabilityRow {
  propertyId: string;
  kind: string;
  family: string;
  capability: FpCapability;
}

/** The property path a family is taken from. */
function familyPath(inv: Invariant): string {
  switch (inv.kind) {
    case 'countMatchesTotal':
      return inv.itemsPath;
    case 'crossField':
      return inv.left;
    case 'pageComplete':
      return inv.upstreamCursorPath;
    default:
      return inv.path;
  }
}

/** The table over a whole contract file, one row per property (invariants, then postconditions). */
export function fpCapabilityTable(
  file: ContractFile,
  endpointFor: (contract: ToolContract) => EndpointMeta,
): FpCapabilityRow[] {
  const rows: FpCapabilityRow[] = [];
  for (const c of file.contracts) {
    const meta = endpointFor(c);
    for (const inv of c.invariants) {
      rows.push({
        propertyId: `${c.id}/${inv.id}`,
        kind: inv.kind,
        family: propertyFamily(familyPath(inv)),
        capability: fpCapability(inv, meta),
      });
    }
    for (const post of c.postconditions ?? []) {
      rows.push({
        propertyId: `${c.id}/${post.id}`,
        kind: 'readAfterWrite',
        family: post.id,
        capability: fpCapability(post, meta),
      });
    }
  }
  return rows;
}
