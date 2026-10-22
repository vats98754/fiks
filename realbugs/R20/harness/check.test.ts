// Unit tests for the R20 contract evaluator, the held-out oracle, the fixtures and adapter.json.
// Pure: no clone, no Docker.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolResultLike } from '../../../packages/contracts/src/index.ts';
import { fixtureLabel, R20_ADAPTER, R20_EXTRA } from './adapter.ts';
import {
  announcedImageDir,
  caseIO,
  evaluateCase,
  expectedBytes,
  heldoutVerdict,
  loadContract,
  NAMED_PROPERTY,
  reportedPaths,
  requestedDir,
  signalsNotDownloaded,
} from './check.ts';
import { BUG_DIR, FIKS_ROOT } from './paths.ts';
import {
  HELDOUT_PATH,
  heldoutCases,
  heldoutFile,
  png,
  sameJson,
  serialize,
  TRIGGER_PATH,
  triggerCase,
} from './synth-fixtures.ts';
import type { Case, CaseRun, FileEntry } from './types.ts';

const contract = loadContract();
const trigger = triggerCase();
const DESC =
  "Download SVG ... Images will be saved relative to the server's image directory: /tmp/r20/project";
const WANTED = '/tmp/r20/project/public/figma-assets/retry-final';
const MISPLACED = `/tmp/r20/project/tmp/r20/project/public/figma-assets/retry-final`;

const text = (t: string): ToolResultLike => ({ content: [{ type: 'text', text: t }] });
const file = (path: string, size = 75, sha256?: string): FileEntry => ({ path, type: 'file', size, sha256 });

function run(result: ToolResultLike | null, files: FileEntry[], extra: Partial<CaseRun> = {}): CaseRun {
  return {
    caseId: 'x',
    description: DESC,
    result,
    rpcError: null,
    files,
    served: [],
    unmatched: [],
    denied: [],
    stderr: '',
    ...extra,
  };
}

const evalRun = (r: CaseRun, c: Case = trigger) => evaluateCase(contract, caseIO(c.args, r, c.server.cwd));

describe('contract', () => {
  it('has the one blind property, with the id the harness names', () => {
    const ps = contract.realbug.properties;
    expect(ps).toHaveLength(1);
    expect(ps[0]?.id).toBe(NAMED_PROPERTY);
    expect(ps[0]?.kind).toBe('fileWrittenRequested');
    expect(ps[0]?.minSize).toBe(1);
  });
});

describe('evaluateCase (fileWrittenRequested)', () => {
  it('prefix shape: success reported, files written under imageDir + the absolute path -> violated per node', () => {
    const r = run(
      text('Downloaded 2 images:\n- retry-bitmap-162-4324.png: 8x6\n- retry-vector-162-4334.svg: 0x0'),
      [file(`${MISPLACED}/retry-bitmap-162-4324.png`), file(`${MISPLACED}/retry-vector-162-4334.svg`, 146)],
    );
    const e = evalRun(r);
    expect(e.verdict).toBe('violated');
    expect(e.violations.map((v) => v.path)).toEqual(['args.nodes[0]', 'args.nodes[1]']);
    expect(e.violations[0]?.message).toContain(
      `the same name was written at ${MISPLACED}/retry-bitmap-162-4324.png`,
    );
  });

  it('fix shape: files where asked, the directory echoed in backticks -> verified', () => {
    const r = run(
      text(
        `Downloaded 2 images to \`${WANTED}\`:\n- retry-bitmap-162-4324.png: 8x6\n- retry-vector-162-4334.svg: 0x0`,
      ),
      [file(`${WANTED}/retry-bitmap-162-4324.png`), file(`${WANTED}/retry-vector-162-4334.svg`, 146)],
    );
    expect(evalRun(r)).toMatchObject({ verdict: 'verified', checked: [NAMED_PROPERTY], violations: [] });
  });

  it('an explicit isError result is unverifiable (no fire); no result at all checks nothing', () => {
    const r = run({ isError: true, content: [{ type: 'text', text: 'Invalid path' }] }, []);
    expect(evalRun(r)).toMatchObject({ verdict: 'unverifiable', checked: [NAMED_PROPERTY], violations: [] });
    expect(evalRun(run(null, []))).toMatchObject({ verdict: 'unverifiable', checked: [] });
  });

  it('an empty file does not satisfy the postcondition (size >= 1)', () => {
    const r = run(text('Downloaded 2 images:'), [
      file(`${WANTED}/retry-bitmap-162-4324.png`, 0),
      file(`${WANTED}/retry-vector-162-4334.svg`, 146),
    ]);
    const e = evalRun(r);
    expect(e.verdict).toBe('violated');
    expect(e.violations[0]?.actual).toEqual({ type: 'file', size: 0 });
  });

  it('a node the response names as failed is exempt (signal); a bare count is not a signal', () => {
    const files = [file(`${WANTED}/retry-vector-162-4334.svg`, 146)];
    const named = run(text('Downloaded 1 images. Failed: retry-bitmap-162-4324.png (no fill URL)'), files);
    expect(evalRun(named).verdict).toBe('verified');
    const count = run(text('Downloaded 1 of 2 images; 1 failed'), files);
    expect(evalRun(count).verdict).toBe('violated');
    expect(signalsNotDownloaded(['could not save 162:4324'], 'a.png', '162:4324')).toBe(true);
    expect(signalsNotDownloaded(['saved 162:4324'], 'a.png', '162:4324')).toBe(false);
  });

  it('relative localPath resolves against the image directory the description announces', () => {
    expect(announcedImageDir(DESC, '/fallback')).toBe('/tmp/r20/project');
    expect(announcedImageDir(null, '/fallback')).toBe('/fallback');
    expect(requestedDir('public/x', '/tmp/r20/project')).toBe('/tmp/r20/project/public/x');
    expect(requestedDir('/abs/../dir', '/tmp/r20/project')).toBe('/dir');
    const c: Case = { ...trigger, args: { ...trigger.args, localPath: 'public/x' } };
    const ok = run(text('ok'), [
      file('/tmp/r20/project/public/x/retry-bitmap-162-4324.png'),
      file('/tmp/r20/project/public/x/retry-vector-162-4334.svg'),
    ]);
    expect(evalRun(ok, c).verdict).toBe('verified');
  });

  it('filenameSuffix: a file containing the suffix with the requested extension counts', () => {
    const c: Case = {
      ...trigger,
      args: {
        ...trigger.args,
        nodes: [{ nodeId: '1:2', imageRef: 'r', fileName: 'b.png', filenameSuffix: 'c0ffee' }],
      },
    };
    expect(evalRun(run(text('ok'), [file(`${WANTED}/b-c0ffee.png`)]), c).verdict).toBe('verified');
    expect(evalRun(run(text('ok'), [file(`${WANTED}/b-c0ffee.svg`)]), c).verdict).toBe('violated');
  });

  it('reported paths: tokens with a separator must exist; bare file names are names', () => {
    expect(
      reportedPaths([
        `Downloaded 1 images: C:\\x\\retry-final/retry-vector-162-4334.svg`,
        '- logo.png: 8x6',
        `to \`${WANTED}\`:`,
      ]),
    ).toEqual(['C:\\x\\retry-final/retry-vector-162-4334.svg']);
    const files = [file(`${WANTED}/retry-bitmap-162-4324.png`), file(`${WANTED}/retry-vector-162-4334.svg`)];
    const echoed = run(text(`Success, 1 images downloaded:\n${WANTED}/missing.svg`), files);
    const e = evalRun(echoed);
    expect(e.verdict).toBe('violated');
    expect(e.violations.map((v) => v.path)).toEqual(['content[*].text']);
  });
});

describe('held-out oracle', () => {
  const h = heldoutCases();
  const pngBytes = Buffer.from(trigger.upstream[1]?.response.bodyBase64 ?? '', 'base64');
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  it('expectedBytes maps each node to the bytes the replayed upstream serves for it', () => {
    const want = expectedBytes(trigger);
    expect(want[0]).toBe(sha(pngBytes));
    expect(want[1]).toBe(sha(Buffer.from(trigger.upstream[3]?.response.bodyBase64 ?? '', 'base64')));
    for (const x of h) expect(expectedBytes(x.case).every((s) => typeof s === 'string')).toBe(true);
  });

  it('manifestation: isError is fine; success needs the exact bytes where asked and no stray file', () => {
    const want = expectedBytes(trigger);
    const good = [
      file(`${WANTED}/retry-bitmap-162-4324.png`, 75, want[0] ?? ''),
      file(`${WANTED}/retry-vector-162-4334.svg`, 146, want[1] ?? ''),
    ];
    expect(heldoutVerdict(trigger, run(text('ok'), good), 'manifestation').ok).toBe(true);
    expect(heldoutVerdict(trigger, run({ isError: true, content: [] }, []), 'manifestation').ok).toBe(true);
    const stray = heldoutVerdict(
      trigger,
      run(text('ok'), [...good, file('/tmp/r20/project/x.png')]),
      'manifestation',
    );
    expect(stray.ok).toBe(false);
    expect(stray.reasons[0]).toContain('stray file');
    const wrongBytes = [{ ...good[0], sha256: 'beef' } as FileEntry, good[1] as FileEntry];
    expect(heldoutVerdict(trigger, run(text('ok'), wrongBytes), 'manifestation').reasons).toEqual([
      'retry-bitmap-162-4324.png: bytes differ from the upstream image',
    ]);
  });

  it('control: refusing a valid relative request is incorrect; an unclean replay is never ok', () => {
    expect(heldoutVerdict(trigger, run({ isError: true, content: [] }, []), 'control').ok).toBe(false);
    const unclean = run({ isError: true, content: [] }, [], { unmatched: ['GET https://api.figma.com/x'] });
    expect(heldoutVerdict(trigger, unclean, 'manifestation').ok).toBe(false);
  });

  it('has 8 cases with distinct ids, one control, none equal to the trigger arguments', () => {
    expect(new Set(h.map((x) => x.case.id)).size).toBe(8);
    expect(h.filter((x) => x.kind === 'control')).toHaveLength(1);
    for (const x of h) expect(JSON.stringify(x.case.args)).not.toBe(JSON.stringify(trigger.args));
  });
});

describe('fixtures', () => {
  it('trigger.json and heldout/cases.json are exactly the synthesizer output', () => {
    expect(sameJson(readFileSync(TRIGGER_PATH, 'utf8'), serialize(triggerCase()))).toBe(true);
    expect(sameJson(readFileSync(HELDOUT_PATH, 'utf8'), serialize(heldoutFile()))).toBe(true);
  });

  it('the synthesized PNG is a valid PNG of the stated size', () => {
    const b = png(8, 6, [1, 2, 3, 255]);
    expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(b.readUInt32BE(16)).toBe(8);
    expect(b.readUInt32BE(20)).toBe(6);
  });

  it('the trigger uses the issue arguments and an absolute localPath inside the project', () => {
    expect(trigger.args.fileKey).toBe('3QAuo1d9LT32Cxju6o7xDt');
    expect(trigger.args.nodes.map((n) => n.nodeId)).toEqual(['162:4324', '162:4334']);
    expect(trigger.args.localPath.startsWith(`${trigger.server.cwd}/`)).toBe(true);
    expect(trigger.label).toBe('synthesized');
  });
});

describe('adapter.json', () => {
  const pins = JSON.parse(readFileSync(join(BUG_DIR, 'pins.json'), 'utf8')) as Record<string, unknown>;

  it('agrees with pins.json and names files that exist', () => {
    expect(R20_ADAPTER.bugId).toBe('R20');
    expect(R20_ADAPTER.prefixSha).toBe(pins.prefixSha);
    expect(R20_ADAPTER.fixSha).toBe(pins.fixSha);
    expect(pins.repo).toBe('vats98754/rb-r20-figma-context-mcp');
    expect(R20_ADAPTER.repoDir).toBe('.work/realbugs/R20');
    for (const p of [R20_ADAPTER.issuePath, R20_ADAPTER.contractPath, R20_EXTRA.triggerFixture]) {
      expect(existsSync(join(FIKS_ROOT, p))).toBe(true);
    }
    for (const f of R20_ADAPTER.fixtures) expect(existsSync(join(FIKS_ROOT, f.path))).toBe(true);
    expect(R20_EXTRA.namedProperty).toBe(NAMED_PROPERTY);
    expect(readFileSync(join(FIKS_ROOT, R20_ADAPTER.issuePath), 'utf8').trim().length).toBeGreaterThan(100);
  });

  it('labels are recorded|synthesized; allowedEditPaths compile and admit the bug files only', () => {
    expect(() => fixtureLabel('made-up')).toThrow();
    const res = R20_ADAPTER.allowedEditPaths.map((s) => new RegExp(s));
    const ok = (p: string) => res.some((r) => r.test(p));
    expect(ok('src/mcp/tools/download-figma-images-tool.ts')).toBe(true);
    expect(ok('src/utils/local-path.ts')).toBe(true);
    expect(ok('src/tests/path-validation.test.ts')).toBe(true);
    expect(ok('package.json')).toBe(false);
    expect(ok('.github/workflows/ci.yml')).toBe(false);
    expect(ok('src/tests/fixtures/x.json')).toBe(false);
    expect(R20_ADAPTER.humanFixTests.every((t) => R20_ADAPTER.suiteScope.includes(t))).toBe(true);
  });
});
