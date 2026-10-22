// The IV sidecar `<trace>.iv.json` (PLAN 3.0, P20/P21; DET's format): which properties of the
// triggering tool's frozen contract issue validation evaluates. It is never shown to an agent.
import { readFileSync } from 'node:fs';
import type { FrozenTrace, IvExclusion } from '@fiks/interfaces';

/** The sidecar fields of a FrozenTrace (the rest of FrozenTrace lives in the trace or F9). */
export type IvSidecar = Pick<
  FrozenTrace,
  'controlCallId' | 'attributableProperties' | 'ivProperties' | 'ivExcluded'
>;

const SIDECAR_KEYS = ['controlCallId', 'attributableProperties', 'ivProperties', 'ivExcluded'] as const;
/** Other FrozenTrace fields a sidecar may repeat (DET may write them); anything else is refused. */
const FROZEN_TRACE_KEYS = new Set<string>([
  ...SIDECAR_KEYS,
  'driftId',
  'callId',
  'path',
  'sha256',
  'violated',
  'target',
  'ivSidecarSha256',
]);
const VERDICTS = new Set(['verified', 'violated', 'unverifiable']);
const PROPERTY_ID = /^[\w.-]+\/[\w.[\]*-]+$/;

/** `D2-trace.json` -> `D2-trace.iv.json` (the sidecar sits next to its trace). */
export const sidecarPathFor = (tracePath: string) => tracePath.replace(/(\.json)?$/, '.iv.json');

/** Problems with a parsed sidecar (empty = valid). */
export function sidecarErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['sidecar must be a JSON object'];
  const x = raw as Record<string, unknown>;
  const errs: string[] = [];
  for (const k of Object.keys(x)) if (!FROZEN_TRACE_KEYS.has(k)) errs.push(`unknown field "${k}"`);
  for (const k of SIDECAR_KEYS) if (!(k in x)) errs.push(`missing field "${k}"`);
  if ('controlCallId' in x && (typeof x.controlCallId !== 'string' || !x.controlCallId))
    errs.push('controlCallId must be a non-empty string');
  const ids = (k: string) => {
    const v = x[k];
    if (!Array.isArray(v) || v.some((p) => typeof p !== 'string' || !PROPERTY_ID.test(p))) {
      errs.push(`${k} must be an array of property ids (<contract>/<property>)`);
      return [] as string[];
    }
    if (new Set(v).size !== v.length) errs.push(`${k} has duplicates`);
    return v as string[];
  };
  const attributable = ids('attributableProperties');
  const iv = ids('ivProperties');
  const excluded: string[] = [];
  if (!Array.isArray(x.ivExcluded)) errs.push('ivExcluded must be an array');
  else
    for (const [i, e] of (x.ivExcluded as unknown[]).entries()) {
      const r = (e ?? {}) as Record<string, unknown>;
      const extra = Object.keys(r).filter((k) => k !== 'property' && k !== 'controlVerdict');
      if (extra.length) errs.push(`ivExcluded[${i}]: unknown field(s) ${extra.join(', ')}`);
      if (typeof r.property !== 'string' || !PROPERTY_ID.test(r.property))
        errs.push(`ivExcluded[${i}].property must be a property id`);
      else excluded.push(r.property);
      if (typeof r.controlVerdict !== 'string' || !VERDICTS.has(r.controlVerdict))
        errs.push(`ivExcluded[${i}].controlVerdict must be verified|violated|unverifiable`);
      // ivProperties are exactly the properties that verify on the control.
      else if (r.controlVerdict === 'verified')
        errs.push(`ivExcluded[${i}]: a property that verifies on the control belongs in ivProperties`);
    }
  for (const p of iv) if (excluded.includes(p)) errs.push(`${p} is both in ivProperties and ivExcluded`);
  // Drift-attributable = violated on the drift call and verified on its control, so it is an ivProperty.
  for (const p of attributable)
    if (!iv.includes(p)) errs.push(`attributable property ${p} is not in ivProperties`);
  const contracts = new Set([...iv, ...excluded].map((p) => p.split('/')[0]));
  if (contracts.size > 1) errs.push(`properties of more than one contract: ${[...contracts].join(', ')}`);
  return errs;
}

export function validateSidecar(raw: unknown, source = 'IV sidecar'): IvSidecar {
  const errs = sidecarErrors(raw);
  if (errs.length) throw new Error(`${source}: ${errs.join('; ')}`);
  const x = raw as IvSidecar;
  return {
    controlCallId: x.controlCallId,
    attributableProperties: [...x.attributableProperties],
    ivProperties: [...x.ivProperties],
    ivExcluded: x.ivExcluded.map((e: IvExclusion) => ({
      property: e.property,
      controlVerdict: e.controlVerdict,
    })),
  };
}

export function loadSidecar(file: string): IvSidecar {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`IV sidecar ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateSidecar(raw, `IV sidecar ${file}`);
}
