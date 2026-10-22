// Authoring briefs (PLAN 5.2 item 2): plain files under paper/blind-protocol/briefs/, hashed at F2.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DomainId, FIKS_ROOT } from './sources.ts';

export const BRIEFS_DIR = join(FIKS_ROOT, 'paper/blind-protocol/briefs');

/** The catalog batch size; the only numeral a catalog brief may contain (check-no-bounds). */
export const BATCH_SIZE = 25;

export type BriefName =
  | 'catalog-shop'
  | 'catalog-tracker'
  | 'contract-author'
  | 'contract-llm'
  | 'contract-format'
  | 'taxonomy'
  | 'drift-realistic'
  | 'drift-evasive'
  | 'benign'
  | 'fixer'
  | 'rater'
  | 'ideation'
  | 'ideation-evasive'
  | 'ideation-benign';

export function briefPath(name: BriefName, dir = BRIEFS_DIR): string {
  return join(dir, `${name}.md`);
}

export function readBrief(name: BriefName, dir = BRIEFS_DIR): string {
  return readFileSync(briefPath(name, dir), 'utf8');
}

/** Every brief file (sorted), for the F2 ledger hashes. */
export function allBriefFiles(dir = BRIEFS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(dir, f));
}

export const catalogBriefName = (d: DomainId): BriefName =>
  d === 'shop' ? 'catalog-shop' : 'catalog-tracker';

/** Catalog briefs get the strict numeral check; every other brief gets the field-bound check. */
export const isCatalogBrief = (file: string) => /(^|\/)catalog-[^/]*\.md$/.test(file);
