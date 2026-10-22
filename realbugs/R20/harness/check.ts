// R20 outcome check (Figma-Context-MCP #364): the blind contract's filesystem postcondition,
// `fileWrittenRequested`, as pure functions over a download_figma_images call and the listing of
// the case root taken after it (harness/sandbox/case-runner.mjs). Same EvalResult/Violation shapes
// as @fiks/contracts. See ../contract-log.md for why the fiks vocabulary cannot express it (C11).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import type { EvalResult, ToolResultLike, Violation } from '../../../packages/contracts/src/index.ts';
import type { Case, CaseRun, DownloadArgs, Exchange, FileEntry } from './types.ts';

export const CONTRACT_PATH = new URL('../contract.json', import.meta.url);
export const NAMED_PROPERTY = 'figma.download_figma_images/fileWritten';

export interface FileWrittenProperty {
  id: string;
  kind: 'fileWrittenRequested';
  tool: string;
  requested: string;
  fileName: string;
  dir: string;
  dirBase: string;
  minSize: number;
  reportedPaths: string;
  signal: string;
  rule: string;
}

export interface R20Contract {
  server: string;
  version: 1;
  contracts: { id: string; tool: string; invariants: unknown[] }[];
  realbug: { bugId: string; writtenFrom: string; properties: FileWrittenProperty[] };
}

export function loadContract(path: URL | string = CONTRACT_PATH): R20Contract {
  const c = JSON.parse(readFileSync(path, 'utf8')) as R20Contract;
  const p = c.realbug?.properties?.[0];
  if (p?.kind !== 'fileWrittenRequested') throw new Error('contract has no fileWrittenRequested property');
  return c;
}

/** What the evaluator needs from one call: the arguments, the result and the listing after it. */
export interface CaseIO {
  args: DownloadArgs;
  result: ToolResultLike | null;
  description: string | null;
  files: FileEntry[];
  /** Fallback image directory when the description does not announce one (the server's cwd). */
  cwd: string;
}

export function caseIO(args: DownloadArgs, run: CaseRun, cwd: string): CaseIO {
  return { args, result: run.result, description: run.description, files: run.files, cwd };
}

/** The image directory the tool description announces ("... image directory: <dir>"). */
export function announcedImageDir(description: string | null, fallback: string): string {
  const m = /image directory:\s*(\S.*?)\s*$/m.exec(description ?? '');
  return m?.[1] ?? fallback;
}

/** Where the caller asked the files to go: localPath if absolute, else imageDir/localPath. */
export function requestedDir(localPath: string, imageDir: string): string {
  return posix.isAbsolute(localPath) ? posix.resolve(localPath) : posix.resolve(imageDir, localPath);
}

function textBlocks(result: ToolResultLike | null): string[] {
  return (result?.content ?? [])
    .filter((b): b is { type: 'text'; text: string } => {
      const o = b as { type?: unknown; text?: unknown };
      return o?.type === 'text' && typeof o.text === 'string';
    })
    .map((b) => b.text);
}

const FAILURE_WORDS =
  /\b(?:fail(?:s|ed|ure)?|error|skip(?:s|ped)?|could not|couldn't|unable)\b|\bnot (?:downloaded|saved|written)\b/i;

/** The response visibly reports this node as not downloaded (the contract's `signal`). */
export function signalsNotDownloaded(texts: string[], fileName: string, nodeId: string): boolean {
  return texts.some((t) => FAILURE_WORDS.test(t) && (t.includes(fileName) || t.includes(nodeId)));
}

/**
 * File paths a response reports: whitespace-separated tokens (surrounding quotes, backticks,
 * brackets and trailing `:`/`,`/`.` stripped) that contain a path separator and end in .png, .svg
 * or .gif. A bare file name ("logo.png: 8x6") is a name, not a path.
 */
export function reportedPaths(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const raw of t.split(/\s+/)) {
      const tok = raw.replace(/^[`'"([<]+/, '').replace(/[`'")\]>:,;.]+$/, '');
      if (/[/\\]/.test(tok) && /\.(?:png|svg|gif)$/i.test(tok)) out.push(tok);
    }
  }
  return [...new Set(out)];
}

const ext = (name: string) => name.slice(name.lastIndexOf('.'));

/** Regular files of at least `minSize` bytes that satisfy node `n` in directory `dir`. */
function matchingFiles(
  files: FileEntry[],
  dir: string,
  fileName: string,
  filenameSuffix: string | undefined,
  minSize: number,
): FileEntry[] {
  return files.filter((f) => {
    if (f.type !== 'file' || f.size < minSize || posix.dirname(f.path) !== dir) return false;
    const base = posix.basename(f.path);
    if (base === fileName) return true;
    return !!filenameSuffix && base.includes(filenameSuffix) && base.endsWith(ext(fileName));
  });
}

export function evaluateCase(contract: R20Contract, io: CaseIO): EvalResult {
  const p = contract.realbug.properties[0] as FileWrittenProperty;
  const contractId = contract.contracts[0]?.id ?? null;
  if (!io.result) return { verdict: 'unverifiable', contractId, checked: [], violations: [] };
  if (io.result.isError) return { verdict: 'unverifiable', contractId, checked: [p.id], violations: [] };
  const imageDir = announcedImageDir(io.description, io.cwd);
  const dir = requestedDir(io.args.localPath, imageDir);
  const texts = textBlocks(io.result);
  const violations: Violation[] = [];
  for (const [i, n] of (io.args.nodes ?? []).entries()) {
    if (matchingFiles(io.files, dir, n.fileName, n.filenameSuffix, p.minSize).length > 0) continue;
    if (signalsNotDownloaded(texts, n.fileName, n.nodeId)) continue;
    const expectedPath = posix.join(dir, n.fileName);
    const at = io.files.find((f) => f.path === expectedPath);
    const elsewhere = io.files
      .filter((f) => f.type === 'file' && posix.basename(f.path) === n.fileName && f.path !== expectedPath)
      .map((f) => `${f.path} (${f.size} B)`);
    violations.push({
      propertyId: p.id,
      kind: p.kind,
      path: `args.nodes[${i}]`,
      expected: `a regular file of >= ${p.minSize} byte(s) at ${expectedPath}`,
      actual: at ? { type: at.type, size: at.size } : null,
      message:
        `download_figma_images reported success but ${expectedPath} ` +
        `${at ? `is a ${at.type} of ${at.size} B` : 'does not exist'}` +
        (elsewhere.length ? `; the same name was written at ${elsewhere.join(', ')}` : ''),
    });
  }
  for (const rp of reportedPaths(texts)) {
    const abs = posix.isAbsolute(rp) ? posix.resolve(rp) : posix.resolve(imageDir, rp);
    const f = io.files.find((x) => x.path === abs);
    if (f && f.type === 'file' && f.size >= p.minSize) continue;
    violations.push({
      propertyId: p.id,
      kind: p.kind,
      path: 'content[*].text',
      expected: `the reported path ${rp} is a regular file of >= ${p.minSize} byte(s)`,
      actual: f ? { type: f.type, size: f.size } : null,
      message: `download_figma_images reported ${rp}, but ${abs} ${f ? `is a ${f.type} of ${f.size} B` : 'does not exist'}`,
    });
  }
  return {
    verdict: violations.length ? 'violated' : 'verified',
    contractId,
    checked: [p.id],
    violations,
  };
}

// ---- held-out oracle ---------------------------------------------------------------------------

export interface HeldoutVerdict {
  ok: boolean;
  reasons: string[];
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** sha256 of the bytes the replayed upstream serves for each requested node (by node index). */
export function expectedBytes(c: Case): (string | null)[] {
  const byUrl = new Map<string, Exchange['response']>();
  for (const x of c.upstream) byUrl.set(new URL(x.request.url).href, x.response);
  const fills: Record<string, string> = {};
  const renders: Record<string, string> = {};
  for (const x of c.upstream) {
    const u = new URL(x.request.url);
    if (u.hostname !== 'api.figma.com' || x.response.body === undefined) continue;
    const body = JSON.parse(x.response.body) as {
      meta?: { images?: Record<string, string> };
      images?: Record<string, string>;
    };
    if (/\/files\/[^/]+\/images$/.test(u.pathname)) Object.assign(fills, body.meta?.images ?? {});
    else Object.assign(renders, body.images ?? {});
  }
  return c.args.nodes.map((n) => {
    const ref = n.gifRef ?? n.imageRef;
    const url = ref ? fills[ref] : renders[n.nodeId.replace(/-/g, ':')];
    const r = url ? byUrl.get(new URL(url).href) : undefined;
    if (!r) return null;
    return sha256(
      r.bodyBase64 !== undefined ? Buffer.from(r.bodyBase64, 'base64') : Buffer.from(r.body ?? ''),
    );
  });
}

/**
 * Direction-neutral held-out oracle. A clean replay is required. A manifestation is handled
 * correctly when the head refuses the input with an explicit isError result, or succeeds having
 * written every requested file where asked (size >= 1, the exact bytes the upstream served) and no
 * file anywhere else. A control (a valid relative request) must succeed that way.
 */
export function heldoutVerdict(c: Case, run: CaseRun, kind: 'manifestation' | 'control'): HeldoutVerdict {
  const reasons: string[] = [];
  for (const k of run.unmatched) reasons.push(`unmatched upstream request ${k}`);
  for (const k of run.denied) reasons.push(`denied upstream request ${k}`);
  if (run.rpcError) reasons.push(`rpc error: ${run.rpcError.message}`);
  if (!run.result) return { ok: false, reasons: reasons.length ? reasons : ['no tool result'] };
  if (run.result.isError) {
    if (kind === 'control') reasons.push('refused a valid relative localPath (control must succeed)');
    return { ok: reasons.length === 0, reasons };
  }
  const imageDir = announcedImageDir(run.description, c.server.cwd);
  const dir = requestedDir(c.args.localPath, imageDir);
  const want = expectedBytes(c);
  const expected = new Set<string>();
  for (const [i, n] of c.args.nodes.entries()) {
    const got = matchingFiles(run.files, dir, n.fileName, n.filenameSuffix, 1);
    if (got.length === 0) {
      reasons.push(`${n.fileName}: no file of >= 1 byte in ${dir}`);
      continue;
    }
    for (const f of got) expected.add(f.path);
    if (want[i] && !got.some((f) => f.sha256 === want[i])) {
      reasons.push(`${n.fileName}: bytes differ from the upstream image`);
    }
  }
  for (const f of run.files) {
    if (f.type === 'file' && !expected.has(f.path)) reasons.push(`stray file ${f.path} (${f.size} B)`);
  }
  return { ok: reasons.length === 0, reasons };
}
