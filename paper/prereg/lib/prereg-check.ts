// check-prereg logic: PREREG.md against PLAN.md (see check-prereg.ts for the CLI).
import { blocksOf, normalize } from './plan-blocks.ts';
import {
  CATEGORIES,
  FILL_MARKER,
  NAMED_RULES,
  type NamedRule,
  PLAN_FIXED_CONSTANTS,
  REQUIRED_CONSTANTS,
  REQUIRED_STATEMENTS,
  SECTIONS,
} from './prereg-rules.ts';

export interface PreregCheck {
  errors: string[];
  blocksChecked: number;
  blocksBySection: Record<string, number>;
  /** category -> rules found verbatim. */
  categories: Record<string, string[]>;
  fills: number;
  constants: Record<string, number>;
}

export interface PreregOptions {
  /** F5 mode: no <<FILL@...>> slot may remain. */
  final?: boolean;
  sections?: readonly string[];
  rules?: NamedRule[];
}

function excerpt(s: string, n = 90): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function parseConstants(md: string): { values: Record<string, number>; errors: string[] } {
  const errors: string[] = [];
  const values: Record<string, number> = {};
  const fences = [...md.matchAll(/^```prereg-constants\n([\s\S]*?)^```/gm)];
  if (fences.length !== 1) {
    return { values, errors: [`expected exactly one \`\`\`prereg-constants block, found ${fences.length}`] };
  }
  for (const raw of (fences[0]?.[1] ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Za-z0-9_.]+)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    if (m === null) {
      errors.push(`constants: cannot parse "${line}"`);
      continue;
    }
    const key = m[1] as string;
    if (key in values) errors.push(`constants: ${key} declared twice`);
    values[key] = Number(m[2]);
  }
  for (const [key, type] of Object.entries(REQUIRED_CONSTANTS)) {
    const v = values[key];
    if (v === undefined) errors.push(`constants: ${key} is not registered`);
    else if (type === 'int' && !Number.isInteger(v)) errors.push(`constants: ${key} must be an integer`);
  }
  for (const [key, v] of Object.entries(PLAN_FIXED_CONSTANTS)) {
    if (values[key] !== undefined && values[key] !== v) {
      errors.push(`constants: ${key} = ${values[key]} but PLAN fixes ${v}`);
    }
  }
  const seeds = Object.entries(values).filter(([k]) => k.startsWith('seed.'));
  const distinct = new Set(seeds.map(([, v]) => v));
  if (distinct.size !== seeds.length) errors.push('constants: seeds are not distinct');
  return { values, errors };
}

export function checkPrereg(plan: string, prereg: string, opts: PreregOptions = {}): PreregCheck {
  const sections = opts.sections ?? SECTIONS;
  const rules = opts.rules ?? NAMED_RULES;
  const errors: string[] = [];
  const target = normalize(prereg);
  const blocksBySection: Record<string, number> = {};
  let blocksChecked = 0;
  const blocks = new Map<string, ReturnType<typeof blocksOf>>();
  for (const s of sections) {
    let bs: ReturnType<typeof blocksOf>;
    try {
      bs = blocksOf(plan, s);
    } catch (e) {
      errors.push(`PLAN: ${(e as Error).message}`);
      continue;
    }
    blocks.set(s, bs);
    blocksBySection[s] = bs.length;
    // Blocks must appear in PLAN order, so a short block cannot be "found" in unrelated text
    // when its own copy was deleted.
    let cursor = 0;
    for (const b of bs) {
      blocksChecked++;
      const at = target.indexOf(b.text, cursor);
      if (at >= 0) {
        cursor = at + b.text.length;
      } else if (target.includes(b.text)) {
        errors.push(`out of PLAN order: PLAN §${s} line ${b.line} (${b.kind}): "${excerpt(b.text)}"`);
      } else {
        errors.push(`missing verbatim: PLAN §${s} line ${b.line} (${b.kind}): "${excerpt(b.text)}"`);
      }
    }
  }

  const categories: Record<string, string[]> = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const rule of rules) {
    const anchor = normalize(rule.anchor);
    const hits = (blocks.get(rule.section) ?? []).filter((b) => b.text.includes(anchor));
    if (hits.length === 0) {
      errors.push(
        `rule ${rule.category} / ${rule.id}: anchor not found in PLAN §${rule.section}: "${excerpt(anchor)}"`,
      );
      continue;
    }
    const missing = hits.filter((b) => !target.includes(b.text));
    if (missing.length > 0) {
      for (const b of missing) {
        errors.push(
          `rule ${rule.category} / ${rule.id}: PLAN §${rule.section} line ${b.line} not verbatim in PREREG`,
        );
      }
      continue;
    }
    const list = categories[rule.category] ?? [];
    list.push(rule.id);
    categories[rule.category] = list;
  }
  for (const c of CATEGORIES) {
    if ((categories[c] ?? []).length === 0) errors.push(`category "${c}": no rule found verbatim`);
  }

  const { values, errors: constErrors } = parseConstants(prereg);
  errors.push(...constErrors);
  for (const st of REQUIRED_STATEMENTS) {
    if (!target.includes(normalize(st.text))) errors.push(`required statement missing: ${st.id}`);
  }
  const fills = prereg.split(FILL_MARKER).length - 1;
  if (opts.final && fills > 0) errors.push(`--final: ${fills} ${FILL_MARKER}…>> slots are still open`);
  return { errors, blocksChecked, blocksBySection, categories, fills, constants: values };
}
