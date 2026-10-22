// check-no-bounds (PLAN 5.2 item 2, F2): the catalog brief contains no numeral except the batch size,
// and neither the docs nor any brief states a numeric bound on a field that a frozen contract
// constrains. Prints the sha256 of every brief and of both docs sets for the F2 ledger entry.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ContractFile } from '@fiks/contracts';
import { allBriefFiles, BATCH_SIZE, isCatalogBrief } from './briefs.ts';
import { sha256 } from './export.ts';
import { DOMAINS, type DomainId, docsPaths, FIKS_ROOT } from './sources.ts';

export const CONTRACTS_DIR = join(FIKS_ROOT, 'packages/contracts/contracts');

/** Every `*.contracts.json` under the contracts dir (frozen contracts; llm-authored included). */
export function frozenContractFiles(dir = CONTRACTS_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.contracts.json')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const leaf = (path: string | undefined): string | undefined => {
  if (!path) return undefined;
  const segs = path
    .replace(/\[(\*|\d+)\]/g, '')
    .split('.')
    .filter(Boolean);
  return segs.at(-1);
};

/** Field names (last path segment) that any check of these contract files constrains. */
export function constrainedFields(files: ContractFile[]): Set<string> {
  const out = new Set<string>();
  const add = (p: unknown) => {
    const l = typeof p === 'string' ? leaf(p) : undefined;
    if (l && l !== '$') out.add(l);
  };
  for (const f of files) {
    for (const c of f.contracts ?? []) {
      for (const inv of c.invariants ?? []) {
        const x = inv as unknown as Record<string, unknown>;
        for (const k of [
          'path',
          'itemsPath',
          'totalPath',
          'upstreamPath',
          'left',
          'right',
          'upstreamCursorPath',
        ])
          add(x[k]);
      }
      for (const post of c.postconditions ?? []) {
        for (const v of Object.values(post.probeArgs ?? {})) add(v);
        for (const e of post.expect ?? []) {
          add(e.probePath);
          add(e.equalsResultPath);
        }
        if (post.upstream) {
          add(post.upstream.idPath);
          add(post.upstream.equalsResultPath);
        }
      }
    }
  }
  return out;
}

/** Comparative phrases followed by a number, ranges, currency amounts and time windows. */
const BOUND_RES: RegExp[] = [
  /\bbetween\s+[$€£]?\s?-?\d[\d,.]*\s*(?:[A-Za-z%]+\s+)?and\s+[$€£]?\s?-?\d/i,
  /\bfrom\s+[$€£]?\s?-?\d[\d,.]*\s*(?:[A-Za-z%]+\s+)?to\s+[$€£]?\s?-?\d/i,
  /\b(?:at\s+(?:least|most)|no\s+(?:more|less|fewer|greater|older|newer)\s+than|(?:more|less|fewer|greater|lower|higher|older|newer|smaller|larger|bigger)\s+than|up\s+to|under|over|above|below|exceed(?:s|ing)?|minimum(?:\s+of)?|maximum(?:\s+of)?|min|max|within(?:\s+the\s+(?:last|next|past))?|capped\s+at|limited\s+to|never\s+(?:more|less|above|below))\s*[:=]?\s*[$€£]?\s?-?\d/i,
  /[<>≤≥]=?\s*[$€£]?\s?-?\d/,
  /[$€£]\s?\d/,
  /\b\d[\d,.]*\s*(?:USD|EUR|GBP|dollars?|cents?)\b/i,
  /\b-?\d[\d,.]*\s*(?:-|–|—|\.\.|to)\s*-?\d[\d,.]*\b/,
  /\b\d[\d,.]*\s*(?:or\s+(?:more|less|fewer|greater|higher|lower|above|below|over|under))\b/i,
  /\b\d[\d,.]*\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i,
];

/** Dates, timestamps, standard names and HTTP statuses carry digits but state no field bound. */
function scrub(line: string): string {
  return line
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, ' ')
    .replace(/\b(?:ISO|RFC|UTF)[- ]?\d+(?:-\d+)?\b/gi, ' ')
    .replace(/`[1-5]\d\d`/g, ' ');
}

export interface BoundProblem {
  file: string;
  line: number;
  text: string;
  reason: string;
}

/** Lines that name a constrained field and state a numeric bound. */
export function proseBoundProblems(file: string, text: string, fields: Set<string>): BoundProblem[] {
  const out: BoundProblem[] = [];
  const names = [...fields].filter((f) => /^[A-Za-z_][\w-]*$/.test(f));
  if (!names.length) return out;
  const fieldRe = new RegExp(
    `(?<![\\w-])(${names.map((n) => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`,
    'i',
  );
  text.split('\n').forEach((raw, i) => {
    const f = fieldRe.exec(raw);
    if (!f) return;
    const s = scrub(raw);
    const b = BOUND_RES.find((re) => re.test(s));
    if (b)
      out.push({
        file,
        line: i + 1,
        text: raw.trim(),
        reason: `numeric bound on constrained field "${f[1]}"`,
      });
  });
  return out;
}

const BOUND_KEYS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'multipleOf',
  'example',
  'examples',
  'default',
];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Component schema names reachable from any response (request-only schemas are not tool outputs). */
function responseSchemas(doc: Json): Set<string> {
  const comps = (
    isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : {}
  ) as Json;
  const reach = new Set<string>();
  const refsIn = (v: unknown, acc: string[]) => {
    if (Array.isArray(v)) for (const x of v) refsIn(x, acc);
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === '$ref' && typeof x === 'string') {
          const m = /^#\/components\/schemas\/(.+)$/.exec(x);
          if (m?.[1]) acc.push(m[1]);
        } else refsIn(x, acc);
      }
    }
  };
  const start: string[] = [];
  for (const item of Object.values(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(item)) continue;
    for (const op of Object.values(item)) if (isObj(op)) refsIn(op.responses, start);
  }
  const queue = [...start];
  while (queue.length) {
    const n = queue.pop() as string;
    if (reach.has(n)) continue;
    reach.add(n);
    const next: string[] = [];
    refsIn(comps[n], next);
    queue.push(...next);
  }
  return reach;
}

/** OpenAPI: response schemas whose constrained properties carry a numeric bound or an example. */
export function openapiBoundProblems(file: string, doc: Json, fields: Set<string>): BoundProblem[] {
  const out: BoundProblem[] = [];
  const comps = (
    isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : {}
  ) as Json;
  const visit = (schema: unknown, where: string) => {
    if (Array.isArray(schema)) {
      for (const [i, s] of schema.entries()) visit(s, `${where}[${i}]`);
      return;
    }
    if (!isObj(schema)) return;
    if (isObj(schema.properties)) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (fields.has(name) && isObj(prop)) {
          const keys = [prop, isObj(prop.items) ? prop.items : {}].flatMap((p) =>
            BOUND_KEYS.filter((k) => k in (p as Json)),
          );
          if (keys.length)
            out.push({
              file,
              line: 0,
              text: `${where}.properties.${name}: ${keys.join(', ')}`,
              reason: `schema bound on constrained field "${name}"`,
            });
        }
      }
    }
    for (const [k, v] of Object.entries(schema)) if (k !== '$ref') visit(v, `${where}.${k}`);
  };
  for (const name of responseSchemas(doc)) visit(comps[name], `components.schemas.${name}`);
  for (const [p, item] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(item)) continue;
    for (const [m, op] of Object.entries(item))
      if (isObj(op)) visit(op.responses, `paths.${p}.${m}.responses`);
  }
  // Free text (descriptions, summaries) anywhere in the document gets the prose check.
  const texts: string[] = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (isObj(v))
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'description' || k === 'summary') && typeof x === 'string') texts.push(x);
        else collect(x);
      }
  };
  collect(doc);
  out.push(...proseBoundProblems(file, texts.join('\n'), fields).map((p) => ({ ...p, line: 0 })));
  return out;
}

/** Numerals in a catalog brief other than the batch size. */
export function catalogNumeralProblems(file: string, text: string): BoundProblem[] {
  const out: BoundProblem[] = [];
  text.split('\n').forEach((raw, i) => {
    for (const m of raw.matchAll(/\d+(?:[.,]\d+)*/g)) {
      if (m[0] !== String(BATCH_SIZE))
        out.push({
          file,
          line: i + 1,
          text: raw.trim(),
          reason: `numeral ${m[0]} (only ${BATCH_SIZE} is allowed)`,
        });
    }
  });
  return out;
}

export interface NoBoundsInput {
  briefs?: string[];
  /** Docs files per domain (default both domains' public docs). */
  docs?: Partial<Record<DomainId, string[]>>;
  /** Extra docs files outside the domain sets (planted checks). */
  extraDocs?: string[];
  contracts?: string[];
}

export interface NoBoundsReport {
  ok: boolean;
  problems: BoundProblem[];
  constrainedFields: string[];
  contracts: string[];
  hashes: {
    briefs: Record<string, string>;
    docs: Record<string, { files: Record<string, string>; setSha256: string }>;
    briefsSetSha256: string;
  };
}

const rel = (p: string) => (p.startsWith(FIKS_ROOT) ? relative(FIKS_ROOT, p) : p);

export function checkNoBounds(input: NoBoundsInput = {}): NoBoundsReport {
  const briefs = input.briefs ?? allBriefFiles();
  const contracts = input.contracts ?? frozenContractFiles();
  const fields = constrainedFields(contracts.map((f) => JSON.parse(readFileSync(f, 'utf8')) as ContractFile));
  const docs: Record<string, string[]> = {};
  for (const d of DOMAINS) docs[d] = input.docs?.[d] ?? docsPaths(d);
  if (input.extraDocs?.length) docs.extra = input.extraDocs;
  const problems: BoundProblem[] = [];
  const briefHashes: Record<string, string> = {};
  for (const b of briefs) {
    const text = readFileSync(b, 'utf8');
    briefHashes[rel(b)] = sha256(text);
    if (isCatalogBrief(b)) problems.push(...catalogNumeralProblems(rel(b), text));
    problems.push(...proseBoundProblems(rel(b), text, fields));
  }
  const docHashes: NoBoundsReport['hashes']['docs'] = {};
  for (const [set, files] of Object.entries(docs)) {
    const fh: Record<string, string> = {};
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      fh[rel(f)] = sha256(text);
      if (f.endsWith('.json')) {
        let doc: unknown;
        try {
          doc = JSON.parse(text);
        } catch (e) {
          problems.push({ file: rel(f), line: 0, text: '', reason: `not JSON: ${(e as Error).message}` });
          continue;
        }
        if (isObj(doc)) problems.push(...openapiBoundProblems(rel(f), doc, fields));
      } else {
        problems.push(...proseBoundProblems(rel(f), text, fields));
      }
    }
    const keys = Object.keys(fh).sort();
    docHashes[set] = { files: fh, setSha256: sha256(keys.map((k) => `${k}\0${fh[k]}\n`).join('')) };
  }
  const bk = Object.keys(briefHashes).sort();
  return {
    ok: problems.length === 0,
    problems,
    constrainedFields: [...fields].sort(),
    contracts: contracts.map(rel),
    hashes: {
      briefs: briefHashes,
      docs: docHashes,
      briefsSetSha256: sha256(bk.map((k) => `${basename(k)}\0${briefHashes[k]}\n`).join('')),
    },
  };
}

export function formatNoBounds(r: NoBoundsReport): string {
  const lines: string[] = [];
  lines.push(`check-no-bounds: ${r.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`constrained fields (${r.contracts.length} contract files): ${r.constrainedFields.join(', ')}`);
  for (const p of r.problems) lines.push(`  ${p.file}${p.line ? `:${p.line}` : ''}: ${p.reason}: ${p.text}`);
  lines.push('sha256 (F2 ledger):');
  for (const [f, h] of Object.entries(r.hashes.briefs)) lines.push(`  brief ${f} ${h}`);
  lines.push(`  briefs-set ${r.hashes.briefsSetSha256}`);
  for (const [set, d] of Object.entries(r.hashes.docs)) {
    for (const [f, h] of Object.entries(d.files)) lines.push(`  docs:${set} ${f} ${h}`);
    lines.push(`  docs-set:${set} ${d.setSha256}`);
  }
  return lines.join('\n');
}
