// R20 fixtures (Figma-Context-MCP #364). No upstream exchange can be recorded: the reporter's
// Figma file is private and no Figma token is used in this study. The Figma REST responses and the
// image bytes are therefore SYNTHESIZED in the documented shapes of the endpoints the server calls
// (GET /v1/files/:key/images for image fills, GET /v1/images/:key for node renders, then a GET of
// each returned S3 URL). The tool arguments are the issue's own (fileKey, nodeIds, imageRef,
// fileNames), with the reporter's absolute Windows localPath rendered as the equivalent absolute
// POSIX path inside the project. Deterministic: rerunning rewrites the same JSON values (run
// `pnpm format` afterwards; --check compares JSON values, not bytes).
//
// usage: pnpm tsx realbugs/R20/harness/synth-fixtures.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { BUG_DIR } from './paths.ts';
import type { Case, Exchange } from './types.ts';

export const FILE_KEY = '3QAuo1d9LT32Cxju6o7xDt';
export const ROOT = '/tmp/r20';
export const PROJECT = `${ROOT}/project`;
const CAPTURED_AT = '2026-10-22T12:40:00.000Z';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A valid RGBA PNG of `w` x `h` pixels in one colour (jimp reads its dimensions). */
export function png(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgba))),
  ]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function svg(w: number, h: number, fill: string): string {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0H${w}V${h}H0V0Z" fill="${fill}"/>\n</svg>\n`;
}

const json = (body: unknown): Exchange['response'] => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

/** Signed S3 URL of an image fill, in the shape GET /v1/files/:key/images returns. */
export function fillUrl(ref: string): string {
  return `https://s3-alpha-sig.figma.com/img/${ref.slice(0, 4)}/${ref.slice(4, 8)}/${ref}?Expires=1793750400&Key-Pair-Id=APKAQ4GOSFWCW27IBOMQ&Signature=fiks-synthesized`;
}

/** S3 URL of a node render, in the shape GET /v1/images/:key returns. */
export function renderUrl(n: number): string {
  return `https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/0b5a1c4e-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function fillsExchange(fileKey: string, images: Record<string, string>): Exchange {
  return {
    request: { method: 'GET', url: `https://api.figma.com/v1/files/${fileKey}/images` },
    response: json({ error: false, status: 200, meta: { images } }),
  };
}

const SVG_QUERY = 'format=svg&svg_outline_text=true&svg_include_id=false&svg_simplify_stroke=true';

export function rendersExchange(
  fileKey: string,
  format: 'svg' | 'png',
  images: Record<string, string>,
  pngScale = 2,
): Exchange {
  const ids = encodeURIComponent(Object.keys(images).join(','));
  const url =
    format === 'svg'
      ? `https://api.figma.com/v1/images/${fileKey}?ids=${ids}&${SVG_QUERY}`
      : `https://api.figma.com/v1/images/${fileKey}?ids=${Object.keys(images).join(',')}&format=png&scale=${pngScale}`;
  return { request: { method: 'GET', url }, response: json({ err: null, images, status: 200 }) };
}

export function bytesExchange(url: string, bytes: Buffer, contentType: string): Exchange {
  return {
    request: { method: 'GET', url },
    response: {
      status: 200,
      headers: { 'content-type': contentType },
      bodyBase64: bytes.toString('base64'),
    },
  };
}

/** Issue case 1 (bitmap fill) + case 2 (vector node) in one call, absolute localPath in the project. */
export function triggerCase(): Case {
  const imageRef = '55e0390ce0dc43e63d023aacfdb023e03ee04644';
  return {
    id: 'r20-trigger',
    label: 'synthesized',
    capturedAt: CAPTURED_AT,
    source:
      "Arguments from issue #364 (fileKey, nodeIds 162:4324 and 162:4334, imageRef, fileNames); the reporter's absolute localPath C:\\Users\\xl\\Desktop\\figma\\public\\figma-assets\\retry-final rendered as the absolute POSIX path of the same directory inside the project (the reporter says Unix-style paths fail the same way). Upstream exchanges synthesized (private file, no token).",
    tool: 'download_figma_images',
    args: {
      fileKey: FILE_KEY,
      nodes: [
        { nodeId: '162:4324', imageRef, fileName: 'retry-bitmap-162-4324.png' },
        { nodeId: '162:4334', fileName: 'retry-vector-162-4334.svg' },
      ],
      localPath: `${PROJECT}/public/figma-assets/retry-final`,
    },
    server: { root: ROOT, cwd: PROJECT, args: [] },
    upstream: [
      fillsExchange(FILE_KEY, { [imageRef]: fillUrl(imageRef) }),
      bytesExchange(fillUrl(imageRef), png(8, 6, [0x33, 0x66, 0x99, 0xff]), 'image/png'),
      rendersExchange(FILE_KEY, 'svg', { '162:4334': renderUrl(1) }),
      bytesExchange(renderUrl(1), Buffer.from(svg(24, 24, '#1E1E1E')), 'image/svg+xml'),
    ],
  };
}

/** The classic 1x1 GIF89a (jimp reads its dimensions). */
export const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export interface HeldoutCase {
  /** manifestation: the head must either write every file where asked or refuse with isError.
   *  control: the head must succeed and write every file where asked (a valid request). */
  kind: 'manifestation' | 'control';
  why: string;
  case: Case;
}

function hcase(
  id: string,
  kind: HeldoutCase['kind'],
  why: string,
  args: Case['args'],
  upstream: Exchange[],
  server: Partial<Case['server']> = {},
): HeldoutCase {
  return {
    kind,
    why,
    case: {
      id,
      label: 'synthesized',
      capturedAt: CAPTURED_AT,
      source: 'Held-out input written for R20 (never shown to a repair arm); upstream synthesized.',
      tool: 'download_figma_images',
      args,
      server: { root: ROOT, cwd: PROJECT, args: [], ...server },
      upstream,
    },
  };
}

/** Held-out manifestations of #364 and non-manifestation controls (distinct from the trigger). */
export function heldoutCases(): HeldoutCase[] {
  const key = 'Hx7kQ2mZ9pLw4Rt8Ny3Vb1';
  const heroRef = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const gifRef = 'f00dfeedc0ffee1234567890abcdef0123456789';
  const logo = svg(32, 32, '#FF5500');
  const pngA = png(12, 8, [0xee, 0x22, 0x44, 0xff]);
  const pngB = png(16, 16, [0x10, 0x80, 0x10, 0xff]);
  const pngC = png(5, 3, [0x00, 0x00, 0x00, 0x80]);
  return [
    hcase(
      'H1-abs-png-render',
      'manifestation',
      'absolute localPath inside the project, one PNG node render at scale 1',
      {
        fileKey: key,
        nodes: [{ nodeId: '7:42', fileName: 'card-shadow.png' }],
        localPath: `${PROJECT}/src/assets/cards`,
        pngScale: 1,
      },
      [
        rendersExchange(key, 'png', { '7:42': renderUrl(11) }, 1),
        bytesExchange(renderUrl(11), pngA, 'image/png'),
      ],
    ),
    hcase(
      'H2-leading-slash',
      'manifestation',
      'POSIX-absolute "/public/images" (the reporter tried Unix-style paths)',
      { fileKey: key, nodes: [{ nodeId: '7:43', fileName: 'logo.svg' }], localPath: '/public/images' },
      [
        rendersExchange(key, 'svg', { '7:43': renderUrl(12) }),
        bytesExchange(renderUrl(12), Buffer.from(logo), 'image/svg+xml'),
      ],
    ),
    hcase(
      'H3-abs-outside',
      'manifestation',
      'absolute localPath outside the image directory',
      {
        fileKey: key,
        nodes: [{ nodeId: '7:44', imageRef: heroRef, fileName: 'hero.png' }],
        localPath: `${ROOT}/elsewhere/assets`,
      },
      [
        fillsExchange(key, { [heroRef]: fillUrl(heroRef) }),
        bytesExchange(fillUrl(heroRef), pngB, 'image/png'),
      ],
    ),
    hcase(
      'H4-relative-control',
      'control',
      'relative localPath (the documented form): every head must write it',
      {
        fileKey: key,
        nodes: [
          { nodeId: '7:44', imageRef: heroRef, fileName: 'hero.png' },
          { nodeId: '7:43', fileName: 'logo.svg' },
        ],
        localPath: 'public/figma-assets/icons',
      },
      [
        fillsExchange(key, { [heroRef]: fillUrl(heroRef) }),
        bytesExchange(fillUrl(heroRef), pngB, 'image/png'),
        rendersExchange(key, 'svg', { '7:43': renderUrl(12) }),
        bytesExchange(renderUrl(12), Buffer.from(logo), 'image/svg+xml'),
      ],
    ),
    hcase(
      'H5-image-dir-flag-gif',
      'manifestation',
      '--image-dir set; absolute localPath inside it; an animated GIF fill',
      {
        fileKey: key,
        nodes: [{ nodeId: '9:1', gifRef, fileName: 'spinner.gif' }],
        localPath: `${ROOT}/site/static/img`,
      },
      [
        fillsExchange(key, { [gifRef]: fillUrl(gifRef) }),
        bytesExchange(fillUrl(gifRef), GIF_1x1, 'image/gif'),
      ],
      { args: ['--image-dir', `${ROOT}/site`], mkdirs: [`${ROOT}/site`] },
    ),
    hcase(
      'H6-abs-filename-suffix',
      'manifestation',
      'absolute localPath inside the project; an image fill with a filenameSuffix',
      {
        fileKey: key,
        nodes: [{ nodeId: '7:45', imageRef: heroRef, fileName: 'banner.png', filenameSuffix: 'c0ffee' }],
        localPath: `${PROJECT}/public/banners`,
      },
      [
        fillsExchange(key, { [heroRef]: fillUrl(heroRef) }),
        bytesExchange(fillUrl(heroRef), pngC, 'image/png'),
      ],
    ),
    hcase(
      'H7-abs-dotdot-inside',
      'manifestation',
      'absolute localPath with a .. segment that still resolves inside the project',
      {
        fileKey: key,
        nodes: [{ nodeId: '7:43', fileName: 'logo.svg' }],
        localPath: `${PROJECT}/public/../assets/brand`,
      },
      [
        rendersExchange(key, 'svg', { '7:43': renderUrl(12) }),
        bytesExchange(renderUrl(12), Buffer.from(logo), 'image/svg+xml'),
      ],
    ),
    hcase(
      'H8-windows-drive-letter',
      'manifestation',
      "the reporter's own Windows path, sent to a POSIX server (not absolute on POSIX: no fire under the contract)",
      {
        fileKey: key,
        nodes: [{ nodeId: '7:43', fileName: 'logo.svg' }],
        localPath: 'C:\\Users\\xl\\Desktop\\figma\\public\\figma-assets\\retry-final',
      },
      [
        rendersExchange(key, 'svg', { '7:43': renderUrl(12) }),
        bytesExchange(renderUrl(12), Buffer.from(logo), 'image/svg+xml'),
      ],
    ),
  ];
}

export const TRIGGER_PATH = resolve(BUG_DIR, 'fixtures', 'trigger.json');
export const HELDOUT_PATH = resolve(BUG_DIR, 'heldout', 'cases.json');

export function heldoutFile(): unknown {
  return {
    bugId: 'R20',
    about:
      'Held-out manifestations of Figma-Context-MCP #364 (never shown to a repair arm) plus a non-manifestation control. All synthesized (hand-written args; upstream in the shapes of the Figma REST endpoints). Graded by heldout/run.ts with heldoutVerdict in harness/check.ts, which accepts either fix direction for a manifestation: write every file where asked, or refuse with isError.',
    cases: heldoutCases(),
  };
}

/** Same JSON value (the files are biome-formatted, so bytes may differ from `serialize`). */
export function sameJson(a: string, b: string): boolean {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

export function serialize(c: unknown): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}

function main(argv: string[]): number {
  const outputs: [string, string][] = [
    [TRIGGER_PATH, serialize(triggerCase())],
    [HELDOUT_PATH, serialize(heldoutFile())],
  ];
  let bad = 0;
  for (const [path, want] of outputs) {
    if (argv.includes('--check')) {
      let have = '';
      try {
        have = readFileSync(path, 'utf8');
      } catch {}
      if (!sameJson(have, want)) {
        console.error(`[r20] ${path} differs from the synthesizer output`);
        bad++;
      } else console.log(`[r20] ${path} is up to date`);
    } else {
      writeFileSync(path, want);
      console.log(`[r20] wrote ${path}`);
    }
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2));
}
