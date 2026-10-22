// `fiks pool` (HOLD; PLAN 5.6 patch pools, 3.0 requestChanging).
//
//   fiks pool --primary --input <drifts.json> --seed <s> [--out <file>]
//       drifts.json: [{drift, requestChanging, candidates: [{id, source, generator, diff}],
//       grades: <GradeRecord[] JSON file>}] (paths relative to the input file). Dedupes by
//       normalised diff, labels each patch by its grade, cross-tabulates generator vs grade, flags
//       drifts with < 3 patches in either class, and prints the pool manifest (with its hash).
//   fiks pool --secondary --input <captured.json> --seed <s> [--cap 30] [--out <file>]
//       captured.json: [{id, drift, arm, diff}] (diff = path). Dedupe + stratified seeded cap per drift.
//   fiks pool --request-changing --pkg <manifest> --trace <trace.json> --enum <dir>
//             --tools-image <img> [--repo-image <img>] [--purpose test]
//       rerecord-head on ref A (in the grading container) over the frozen trace and enumeration.
//   fiks pool --generate --pkg <manifest> --description <file> --llm stub|live --out <dir>
//       Primary-pool candidates: P1-P8 on ref A (MUT prompts), plausible-wrong and alternative
//       fixes (HOLD prompts). `live` calls models through LLMR (never from tests); `stub` echoes
//       ref A for plumbing checks.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getDomain } from '@fiks/domains';
import type { CandidateLlm, CapturedCandidate, PoolCandidate } from '@fiks/heldout';
import type { CliCommandModule, GradeRecord } from '@fiks/interfaces';

interface PrimaryInput {
  drift: string;
  requestChanging: boolean;
  candidates: (Omit<PoolCandidate, 'diff'> & { diff: string })[];
  grades: string;
}

const emit = (out: unknown, file: string | undefined) => {
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (file) {
    mkdirSync(dirname(resolve(file)), { recursive: true });
    writeFileSync(file, text);
  }
  process.stdout.write(text);
};

const command: CliCommandModule = {
  name: 'pool',
  describe: 'patch pools for H2: primary/secondary builders, requestChanging, candidate generation (HOLD)',
  async run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        primary: { type: 'boolean', default: false },
        secondary: { type: 'boolean', default: false },
        'request-changing': { type: 'boolean', default: false },
        generate: { type: 'boolean', default: false },
        input: { type: 'string' },
        seed: { type: 'string' },
        cap: { type: 'string' },
        out: { type: 'string' },
        pkg: { type: 'string' },
        trace: { type: 'string' },
        enum: { type: 'string' },
        description: { type: 'string' },
        llm: { type: 'string' },
        'tools-image': { type: 'string' },
        'repo-image': { type: 'string' },
        purpose: { type: 'string' },
      },
    });
    const heldout = await import('@fiks/heldout');
    if (values.primary || values.secondary) {
      if (!values.input || !values.seed) {
        console.error('usage: fiks pool --primary|--secondary --input <file> --seed <s> [--out <file>]');
        return 2;
      }
      const inputFile = resolve(values.input);
      const at = (p: string) => resolve(dirname(inputFile), p);
      if (values.primary) {
        const drifts = (JSON.parse(readFileSync(inputFile, 'utf8')) as PrimaryInput[]).map((d) => ({
          drift: d.drift,
          requestChanging: d.requestChanging,
          candidates: d.candidates.map((c) => ({
            ...c,
            diff: c.diff ? readFileSync(at(c.diff), 'utf8') : '',
          })),
          grades: JSON.parse(readFileSync(at(d.grades), 'utf8')) as GradeRecord[],
        }));
        emit(heldout.buildPrimaryPool(drifts, { seed: values.seed }), values.out);
        return 0;
      }
      const captured = (JSON.parse(readFileSync(inputFile, 'utf8')) as CapturedCandidate[]).map((c) => ({
        ...c,
        diff: readFileSync(at(c.diff), 'utf8'),
      }));
      const cap = values.cap ? Number(values.cap) : undefined;
      emit(heldout.buildSecondaryPool(captured, { seed: values.seed, cap }), values.out);
      return 0;
    }
    if (!values.pkg) {
      console.error('usage: fiks pool --request-changing|--generate --pkg <manifest> ...');
      return 2;
    }
    const p = await heldout.loadPackage(values.pkg);
    const d = getDomain(p.pkg.domain);
    if (values['request-changing']) {
      if (!values.trace || !values.enum || !values['tools-image']) {
        console.error(
          'usage: fiks pool --request-changing --pkg <m> --trace <f> --enum <dir> --tools-image <img>',
        );
        return 2;
      }
      const repoImage = values['repo-image'] ?? (await heldout.repoImageFor(d.repo.dir(), p.pkg.base));
      const traceBytes = readFileSync(values.trace, 'utf8');
      const enumDir = values.enum;
      const r = await heldout.requestChanging(p, {
        repoDir: d.repo.dir(),
        sandbox: heldout.dockerSandboxFactory({
          repoImage,
          toolsImage: values['tools-image'],
          purpose: values.purpose === 'test' ? 'test' : 'run',
        }),
        trace: { id: (JSON.parse(traceBytes) as { id: string }).id, bytes: traceBytes },
        enumeration: readdirSync(enumDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => join(enumDir, f)),
      });
      emit(r, values.out);
      return 0;
    }
    if (values.generate) {
      if (!values.description || !values.out || (values.llm !== 'stub' && values.llm !== 'live')) {
        console.error(
          'usage: fiks pool --generate --pkg <m> --description <file> --llm stub|live --out <dir>',
        );
        return 2;
      }
      const refA = readFileSync(p.refA, 'utf8');
      let llm: CandidateLlm;
      if (values.llm === 'stub') {
        llm = async () => `\`\`\`diff\n${refA}\`\`\``;
      } else {
        llm = heldout.liveCandidateLlm(`pool:${p.pkg.id}`);
      }
      const { candidates, log } = await heldout.generateCandidates(p, {
        repoDir: d.repo.dir(),
        llm,
        description: readFileSync(values.description, 'utf8'),
      });
      mkdirSync(values.out, { recursive: true });
      for (const c of candidates)
        writeFileSync(join(values.out, `${c.id.replace(/\//g, '__')}.patch`), c.diff);
      emit(
        {
          drift: p.pkg.id,
          candidates: candidates.map(({ diff: _d, ...c }) => ({
            ...c,
            diff: `${c.id.replace(/\//g, '__')}.patch`,
          })),
          log,
        },
        join(values.out, 'candidates.json'),
      );
      return 0;
    }
    console.error('fiks pool: one of --primary, --secondary, --request-changing, --generate');
    return 2;
  },
};

export default command;
