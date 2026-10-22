// The export deny list (PLAN 5.2 item 2). Applied to every blind export, whatever its kind: a file
// is left out when its export-relative path matches a path rule or its bytes contain a sentinel.

/** Path rules, tested against the export-relative POSIX path. */
export const DENY_PATH_RULES: readonly { id: string; test: (rel: string) => boolean }[] = [
  { id: 'test/fiks/**', test: (rel) => /(^|\/)test\/fiks(\/|$)/.test(rel) },
  { id: '*.contracts.json', test: (rel) => /\.contracts\.json$/i.test(rel) },
  { id: 'evaluate.ts', test: (rel) => /(^|\/)evaluate\.ts$/.test(rel) },
  { id: 'test/repro/**', test: (rel) => /(^|\/)test\/repro(\/|$)/.test(rel) },
  { id: 'test/traces/**', test: (rel) => /(^|\/)test\/traces(\/|$)/.test(rel) },
  { id: '.git', test: (rel) => /(^|\/)\.git(\/|$)/.test(rel) },
];

/** Content sentinels: a file whose bytes contain any of them is left out. */
export const DENY_CONTENT: readonly { id: string; re: RegExp }[] = [
  { id: 'fiks_receipt', re: /fiks_receipt/ },
  { id: '@fiks/', re: /@fiks\// },
  { id: 'outcome contract', re: /outcome contract/i },
];

/** Strings that must never reach an author session (checked in transcripts by `auditTranscript`). */
export const TRANSCRIPT_SENTINELS: readonly string[] = [
  'D3 lost write: create_order returns 200',
  'Fiks — self-healing tools for AI agents',
  'fiks_receipt',
  'outcome contract',
];

export function deniedPath(rel: string): string | null {
  for (const r of DENY_PATH_RULES) if (r.test(rel)) return r.id;
  return null;
}

export function deniedContent(bytes: Uint8Array | string): string | null {
  const text = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8');
  for (const c of DENY_CONTENT) if (c.re.test(text)) return c.id;
  return null;
}

/** The deny reason for one file, or null when it may be exported. */
export function denyReason(rel: string, bytes: Uint8Array | string): string | null {
  const p = deniedPath(rel);
  if (p) return `path:${p}`;
  const c = deniedContent(bytes);
  return c ? `content:${c}` : null;
}
