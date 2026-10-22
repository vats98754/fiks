// `fiks enumerate` (DET; PLAN 3.1 strata, 5.7, 7 P20): EnumRow JSONL plus its sha256.
//
//   fiks enumerate --domain <d> --frame --catalog extended-only|original --seed <s> --out <file>
//                  [--contracts <file>]
//   fiks enumerate --drift <DriftPackage.json> --out <file> [--seed <s>] [--sample 50] [--grid 50]
//
// --frame: the domain's strata (S-ext, S-grid, S-write) on the catalog, without the contracts'
// knownGoodInputs (read as data from --contracts, default the domain's frozen contracts when the
// file exists) and, on extended-only, without any row naming an original entity.
// --drift: tools touching the rule's endpoint x (original catalog + seeded extended sample) + the
// first --grid queries of the seeded grid + touching S-write pairs, on catalog `all`. Seed
// default: the drift id. Prints `sha256 <hex>`; with --json a JSON summary.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getDomain } from '@fiks/domains';
import {
  DRIFT_GRID_SIZE,
  DRIFT_SAMPLE_SIZE,
  driftEnumeration,
  type EnumResult,
  frameEnumeration,
  type KnownGood,
  writeJsonl,
} from '@fiks/frame';
import { loadDriftPackage } from '@fiks/injector';
import type { Catalog, CliCommandModule } from '@fiks/interfaces';

const USAGE =
  'enumerate (--domain <d> --frame --catalog extended-only|original --seed <s> [--contracts <file>] | --drift <pkg.json> [--seed <s>] [--sample n] [--grid n]) --out <file.jsonl> [--json]';

/** knownGoodInputs per tool from a contract file (plain data; nothing is evaluated). */
export function knownGoodFrom(file: string | undefined): KnownGood {
  if (!file || !existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    contracts?: { tool: string; knownGoodInputs?: Record<string, unknown>[] }[];
  };
  const out: KnownGood = {};
  for (const c of parsed.contracts ?? []) if (c.knownGoodInputs?.length) out[c.tool] = c.knownGoodInputs;
  return out;
}

export interface EnumerateOutput extends EnumResult {
  out: string;
  sha256: string;
  domain: string;
  mode: 'frame' | 'drift';
}

export function runEnumerate(opts: {
  domain?: string;
  frame?: boolean;
  catalog?: string;
  seed?: string;
  contracts?: string;
  drift?: string;
  sample?: number;
  grid?: number;
  out: string;
}): EnumerateOutput {
  let result: EnumResult;
  let domainId: string;
  if (opts.drift) {
    const loaded = loadDriftPackage(resolve(opts.drift));
    domainId = loaded.pkg.domain;
    result = driftEnumeration(getDomain(domainId), {
      match: loaded.rule.match,
      seed: opts.seed ?? loaded.pkg.id,
      sampleSize: opts.sample ?? DRIFT_SAMPLE_SIZE,
      gridSize: opts.grid ?? DRIFT_GRID_SIZE,
    });
  } else {
    if (!opts.domain || !opts.frame || opts.seed === undefined) throw new Error(`usage: fiks ${USAGE}`);
    const catalog = (opts.catalog ?? 'extended-only') as Catalog;
    if (catalog !== 'extended-only' && catalog !== 'original') {
      throw new Error('--frame --catalog must be extended-only or original');
    }
    domainId = opts.domain;
    const domain = getDomain(domainId);
    result = frameEnumeration(domain, {
      catalog,
      seed: opts.seed,
      knownGood: knownGoodFrom(opts.contracts ?? domain.contractsPath),
    });
  }
  const out = resolve(opts.out);
  const sha256 = writeJsonl(out, result.rows);
  writeFileSync(`${out}.sha256`, `${sha256}  ${out.split('/').pop()}\n`);
  return { ...result, out, sha256, domain: domainId, mode: opts.drift ? 'drift' : 'frame' };
}

const command: CliCommandModule = {
  name: 'enumerate',
  describe: 'Enumerate frame or per-drift inputs as EnumRow JSONL (DET, PLAN 5.7)',
  run(argv) {
    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          domain: { type: 'string' },
          frame: { type: 'boolean', default: false },
          catalog: { type: 'string' },
          seed: { type: 'string' },
          contracts: { type: 'string' },
          drift: { type: 'string' },
          sample: { type: 'string' },
          grid: { type: 'string' },
          out: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      console.error(`${(e as Error).message}\nusage: fiks ${USAGE}`);
      return 2;
    }
    if (!values.out || (!values.drift && !values.frame)) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    try {
      const r = runEnumerate({
        domain: values.domain as string | undefined,
        frame: values.frame === true,
        catalog: values.catalog as string | undefined,
        seed: values.seed as string | undefined,
        contracts: values.contracts as string | undefined,
        drift: values.drift as string | undefined,
        sample: values.sample ? Number(values.sample) : undefined,
        grid: values.grid ? Number(values.grid) : undefined,
        out: values.out as string,
      });
      if (values.json) {
        console.log(
          JSON.stringify({
            out: r.out,
            sha256: r.sha256,
            rows: r.rows.length,
            domain: r.domain,
            mode: r.mode,
            excluded: r.excluded,
            ...(r.sample ? { sample: r.sample } : {}),
          }),
        );
      } else {
        console.log(`wrote ${r.rows.length} rows to ${r.out}\nsha256 ${r.sha256}`);
      }
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
  },
};

export default command;
