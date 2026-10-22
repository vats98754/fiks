// Checks packages/arms/FIDELITY.md (WORKSTREAMS ARMS):
//  - every product in the "Named products" table has an https URL and a quoted passage;
//  - each passage is verbatim in its recorded source: the bibliography entry of its key (quote,
//    cite_claims quotes, verifier evidence) or, for langsmith-changelog-2026, the recorded re-fetch
//    paper/research/verify/arms-langsmith-recheck.json;
//  - the Engine entries quote "up to three revisions or 90 minutes per chain" and "replays each
//    source run against its fix preview deployment" with location October 5-12, 2026, and both come
//    from the recorded re-fetch;
//  - a known product named anywhere in the file has a row in the table.
//
//   pnpm tsx packages/arms/src/check-fidelity.ts [--file <FIDELITY.md>]   (exit 0 = pass)
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIKS_ROOT } from './rules.ts';

export const ENGINE_STRINGS = [
  'up to three revisions or 90 minutes per chain',
  'replays each source run against its fix preview deployment',
] as const;
const ENGINE_LOCATION = /October 5-12, 2026/;
/** Product names the arms cite (PLAN 6.2); naming one requires a table row. */
const KNOWN_PRODUCTS = ['Devin', 'Cursor', 'Copilot', 'Seer', 'Bits AI', 'PostHog', 'Engine'];

export interface FidelityRow {
  product: string;
  key: string;
  url: string;
  location: string;
  quote: string;
}

export function parseProducts(md: string): FidelityRow[] {
  const start = md.indexOf('## Named products');
  if (start < 0) throw new Error('FIDELITY.md has no "## Named products" section');
  const rest = md.slice(start).split('\n').slice(1);
  const rows: FidelityRow[] = [];
  for (const line of rest) {
    if (line.startsWith('## ')) break;
    if (!line.startsWith('|') || /^\|\s*(Product|---)/.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const [product = '', key = '', url = '', location = '', quoteCell = ''] = cells;
    const quote = /^"(.*)"$/.exec(quoteCell)?.[1] ?? '';
    rows.push({ product, key, url, location, quote });
  }
  return rows;
}

interface BibEntry {
  key: string;
  aliases: string[];
  url: string;
  quote: string;
  cite_claims: { quote: string; verifier_evidence: string }[];
}

export function checkFidelity(root = FIKS_ROOT, file = join(root, 'packages/arms/FIDELITY.md')): string[] {
  const md = readFileSync(file, 'utf8');
  const bib = JSON.parse(readFileSync(join(root, 'paper/research/bibliography.json'), 'utf8')) as BibEntry[];
  const recheck = JSON.parse(
    readFileSync(join(root, 'paper/research/verify/arms-langsmith-recheck.json'), 'utf8'),
  ) as { url: string; passages: { heading: string; quote: string }[] };
  const errs: string[] = [];
  const rows = parseProducts(md);
  if (!rows.length) errs.push('no product rows');
  for (const r of rows) {
    const where = `${r.product} (${r.key})`;
    if (!/^https:\/\/\S+$/.test(r.url)) errs.push(`${where}: no URL`);
    if (!r.quote) {
      errs.push(`${where}: no quoted passage`);
      continue;
    }
    const e = bib.find((b) => b.key === r.key || b.aliases.includes(r.key));
    if (!e) {
      errs.push(`${where}: unknown bibliography key`);
      continue;
    }
    if (e.url !== r.url) errs.push(`${where}: URL ${r.url} differs from the bibliography's ${e.url}`);
    if (r.key === 'langsmith-changelog-2026') {
      const p = recheck.passages.find((x) => x.quote.includes(r.quote));
      if (!p) errs.push(`${where}: "${r.quote}" is not in the recorded re-fetch`);
      else if (!r.location.includes(p.heading))
        errs.push(`${where}: location "${r.location}" is not the re-fetch heading "${p.heading}"`);
      continue;
    }
    const sources = [e.quote, ...e.cite_claims.flatMap((c) => [c.quote, c.verifier_evidence])];
    if (!sources.some((s) => s.includes(r.quote)))
      errs.push(`${where}: "${r.quote}" is not in its verified source`);
  }
  for (const s of ENGINE_STRINGS) {
    const row = rows.find((r) => r.key === 'langsmith-changelog-2026' && r.quote === s);
    if (!row) errs.push(`Engine entry quoting "${s}" is missing`);
    else if (!ENGINE_LOCATION.test(row.location))
      errs.push(`Engine entry "${s}": location is not October 5-12, 2026`);
    if (!recheck.passages.some((p) => p.quote.includes(s) && ENGINE_LOCATION.test(p.heading)))
      errs.push(`"${s}" is not in the recorded re-fetch under October 5-12, 2026`);
  }
  for (const name of KNOWN_PRODUCTS) {
    if (md.includes(name) && !rows.some((r) => r.product.includes(name)))
      errs.push(`${name} is named but has no row with a URL and a quoted passage`);
  }
  return errs;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--file');
  const errs = checkFidelity(FIKS_ROOT, i > 0 ? process.argv[i + 1] : undefined);
  if (errs.length) {
    for (const e of errs) console.error(`FAIL ${e}`);
    process.exitCode = 1;
  } else {
    const rows = parseProducts(readFileSync(join(FIKS_ROOT, 'packages/arms/FIDELITY.md'), 'utf8'));
    console.log(
      `FIDELITY.md: ${rows.length} product rows, each with a URL and a verified quoted passage; both Engine strings from the recorded re-fetch (October 5-12, 2026)`,
    );
  }
}
