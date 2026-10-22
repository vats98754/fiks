#!/usr/bin/env node
// The registered A0 response (paper/PLAN.md §8.1 A0, §9.5): marks exactly the listed contract
// properties `disabled: true` with a `disabledReason`, and nothing else. A disabled property is
// not evaluated (packages/contracts evaluate.ts lists it under the receipt's `disabled[]`); MON
// `replay-cli --reenable <ids>` evaluates it offline. This is the only tool that sets the flag.
//
//   node scripts/contract-disable.mjs --contracts <file> --ids <id,...> --reason <text> --log <jsonl>
//
// Ids are full property ids, `<contract id>/<property id>` (e.g. `shop.get_product/price.range`),
// covering invariants and postconditions. Exit 2 (file unchanged) on a usage error, an unknown
// id or an id that is already disabled. The edit is textual (the file keeps its layout), and a
// structural JSON diff of before vs after must show only the listed properties' `disabled` and
// `disabledReason`, or nothing is written (exit 1). On success it appends one D11 log line:
// {at, contracts, ids, reason, contractsSha256Before, contractsSha256After}.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = new URL('..', import.meta.url).pathname;
const usage =
  'usage: node scripts/contract-disable.mjs --contracts <file> --ids <id,...> --reason <text> --log <jsonl>';
const die = (code, message) => {
  console.error(`[contract-disable] ${message}`);
  process.exit(code);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      contracts: { type: 'string' },
      ids: { type: 'string' },
      reason: { type: 'string' },
      log: { type: 'string' },
    },
  }));
} catch (e) {
  die(2, `${e.message}\n${usage}`);
}
if (!values.contracts || !values.ids || !values.reason?.trim() || !values.log) die(2, usage);
const file = resolve(values.contracts);
const ids = [...new Set(values.ids.split(',').map((s) => s.trim()))].filter(Boolean);
if (!ids.length) die(2, 'no ids given');
const reason = values.reason.trim();

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const before = readFileSync(file, 'utf8');
let doc;
let tree;
try {
  doc = JSON.parse(before);
  tree = parseWithOffsets(before);
} catch (e) {
  die(2, `${file} is not JSON: ${e.message}`);
}

// Every property: `<contract id>/<property id>` -> its node in `tree` and its parsed value.
const properties = new Map();
const contracts = Array.isArray(doc.contracts) ? doc.contracts : [];
for (const [i, c] of contracts.entries()) {
  for (const list of ['invariants', 'postconditions']) {
    for (const [j, p] of (Array.isArray(c?.[list]) ? c[list] : []).entries()) {
      const node = member(member(member(member(tree, 'contracts'), i), list), j);
      properties.set(`${c.id}/${p?.id}`, { value: p, node, path: ['contracts', i, list, j] });
    }
  }
}
const unknown = ids.filter((id) => !properties.has(id));
if (unknown.length) {
  die(2, `unknown property ids: ${unknown.join(', ')} (known: ${[...properties.keys()].join(', ')})`);
}
const already = ids.filter((id) => properties.get(id).value.disabled === true);
if (already.length) die(2, `already disabled: ${already.join(', ')}`);

// Textual insertion before each listed property's closing brace, last offset first.
let after = before;
const edits = ids.map((id) => properties.get(id).node).sort((a, b) => b.end - a.end);
for (const node of edits) {
  const close = node.end - 1; // the '}'
  let last = close - 1;
  while (/\s/.test(after[last])) last--;
  const text = after.slice(node.start, node.end);
  const fields = [`"disabled": true`, `"disabledReason": ${JSON.stringify(reason)}`];
  let insert;
  if (text.includes('\n')) {
    const firstKey = after.indexOf('"', node.start);
    const lineStart = after.lastIndexOf('\n', firstKey) + 1;
    const indent = after.slice(lineStart, firstKey);
    insert = fields.map((f) => `,\n${indent}${f}`).join('');
  } else {
    insert = fields.map((f) => `, ${f}`).join('');
  }
  after = after.slice(0, last + 1) + insert + after.slice(last + 1);
}
after = formatLikeBefore(before, after);

// Verify: the only structural changes are the listed properties' two fields.
const allowed = new Set();
for (const id of ids) {
  const p = properties.get(id).path.join('/');
  allowed.add(`${p}/disabled`);
  allowed.add(`${p}/disabledReason`);
}
let parsedAfter;
try {
  parsedAfter = JSON.parse(after);
} catch (e) {
  die(1, `internal error, edited file is not JSON (${e.message}); nothing written`);
}
const changes = diff(doc, parsedAfter, []);
const unexpected = changes.filter((c) => !allowed.has(c));
const missing = [...allowed].filter((a) => !changes.includes(a));
if (unexpected.length || missing.length) {
  die(1, `JSON diff check failed; nothing written (unexpected: ${unexpected}, missing: ${missing})`);
}
for (const id of ids) {
  const p = properties.get(id).path;
  const got = p.reduce((o, k) => o[k], parsedAfter);
  if (got.disabled !== true || got.disabledReason !== reason)
    die(1, `internal error on ${id}; nothing written`);
}

writeFileSync(file, after);
const line = {
  at: new Date().toISOString(),
  contracts: values.contracts,
  ids,
  reason,
  contractsSha256Before: sha256(before),
  contractsSha256After: sha256(after),
};
mkdirSync(dirname(resolve(values.log)), { recursive: true });
appendFileSync(values.log, `${JSON.stringify(line)}\n`);
console.log(`[contract-disable] disabled ${ids.join(', ')} in ${values.contracts}`);

/** Paths (joined with '/') where `a` and `b` differ; a key present on one side only is a change. */
function diff(a, b, path) {
  const here = path.join('/');
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [here];
  }
  if (Array.isArray(a) !== Array.isArray(b)) return [here];
  if (Array.isArray(a) && a.length !== b.length) return [here];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    const key = Array.isArray(a) ? Number(k) : k;
    if (!(k in a) || !(k in b)) out.push([...path, key].join('/'));
    else out.push(...diff(a[k], b[k], [...path, key]));
  }
  return out;
}

/**
 * Keeps the repo's formatting: when the file was Biome-formatted before (fiks's own Biome and
 * config), the edited text is Biome-formatted too; otherwise it is left as edited.
 */
function formatLikeBefore(original, edited) {
  const biome = join(root, 'node_modules/.bin/biome');
  if (!existsSync(biome)) return edited;
  const fmt = (input) =>
    execFileSync(biome, ['format', '--stdin-file-path=contracts.json'], {
      cwd: root,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  try {
    return fmt(original) === original ? fmt(edited) : edited;
  } catch {
    return edited;
  }
}

/** A child node of an object (by key) or array (by index) in the offset tree. */
function member(node, key) {
  const child = node?.children?.get(key);
  if (!child) throw new Error(`no ${key} in the contracts file`);
  return child;
}

/** Minimal JSON parser that records each object's and array's [start, end) offsets. */
function parseWithOffsets(src) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(src[i] ?? '')) i++;
  };
  const str = () => {
    const start = i++;
    while (src[i] !== '"') {
      if (i >= src.length) throw new Error('unterminated string');
      i += src[i] === '\\' ? 2 : 1;
    }
    i++;
    return JSON.parse(src.slice(start, i));
  };
  const value = () => {
    ws();
    const start = i;
    if (src[i] === '{') {
      i++;
      const children = new Map();
      ws();
      if (src[i] === '}') i++;
      else {
        for (;;) {
          ws();
          const k = str();
          ws();
          i++; // ':'
          children.set(k, value());
          ws();
          if (src[i++] === '}') break;
        }
      }
      return { start, end: i, children };
    }
    if (src[i] === '[') {
      i++;
      const children = new Map();
      ws();
      if (src[i] === ']') i++;
      else {
        for (let n = 0; ; n++) {
          children.set(n, value());
          ws();
          if (src[i++] === ']') break;
        }
      }
      return { start, end: i, children };
    }
    if (src[i] === '"') str();
    else while (i < src.length && !/[\s,\]}]/.test(src[i])) i++;
    return { start, end: i };
  };
  const out = value();
  ws();
  if (i !== src.length) throw new Error('trailing characters');
  return out;
}
