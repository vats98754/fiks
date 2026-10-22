// `fiks frame-k` (DET; PLAN 3.1, 5.7, 7 P20, Appendix `FrameSpec`).
//
//   fiks frame-k --records <dir>[,<dir>...] --out <frame-spec.json> [--domain shop,tracker]
//                [--contracts <file> | --contracts shop=<file>,tracker=<file>]
//                [--top-up-batches n] [--report <file>] [--json]
//
// Reads pre-F4b frame records (`record --frame --monitor none`: outputs, upstream exchanges,
// truth() comparison, Domain.originEntity/entityClass labels; no verdict) and writes the FrameSpec:
// n_F, the Clean set, eligible inputs, entities with authorBatch and eligibility, N_E, attribution
// by concrete element path, property families, cells, K, entailed properties, crit and power at
// N_E, and the sha256 of the record set (the calls.jsonl bytes, in --records order). Contracts
// are read as data for fpCapability/propertyFamily and path resolution only; nothing is evaluated.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ContractFile } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import {
  CALLS_FILE,
  type DetCallRecord,
  type FrameDomainInput,
  type FrameKReport,
  frameK,
  MANIFEST_FILE,
  type RecordManifest,
  readJsonl,
  sha256Hex,
  writeJson,
} from '@fiks/frame';
import type { CliCommandModule } from '@fiks/interfaces';

function contractsFor(spec: string | undefined, domain: string): string {
  if (!spec) return getDomain(domain).contractsPath;
  if (!spec.includes('=')) return spec;
  for (const part of spec.split(',')) {
    const [d, file] = part.split('=');
    if (d === domain && file) return file;
  }
  return getDomain(domain).contractsPath;
}

export function runFrameK(opts: {
  records: string[];
  domains?: string[];
  contracts?: string;
  topUpBatches?: number;
}): FrameKReport {
  const dirs = opts.records.map((d) => resolve(d));
  const bytes: Buffer[] = [];
  const records: DetCallRecord[] = [];
  const domains = new Map<string, FrameDomainInput>();
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as RecordManifest;
    if (manifest.kind !== 'frame')
      throw new Error(`frame-k: ${dir} holds ${manifest.kind} records, not --frame`);
    if (manifest.monitor !== 'none') {
      throw new Error(
        `frame-k: ${dir} was recorded with --monitor ${manifest.monitor}; F needs --monitor none`,
      );
    }
    if (opts.domains && !opts.domains.includes(manifest.domain)) continue;
    const file = join(dir, CALLS_FILE);
    bytes.push(readFileSync(file));
    records.push(...readJsonl<DetCallRecord>(file));
    const d = domains.get(manifest.domain);
    const entities = manifest.extended?.entities ?? [];
    if (d) d.entities = [...d.entities, ...entities.filter((e) => !d.entities.some((x) => x.id === e.id))];
    else {
      const domain = getDomain(manifest.domain);
      domains.set(manifest.domain, {
        id: manifest.domain,
        contracts: JSON.parse(
          readFileSync(contractsFor(opts.contracts, manifest.domain), 'utf8'),
        ) as ContractFile,
        paginatedEndpoints: domain.paginatedEndpoints,
        entities,
      });
    }
  }
  for (const id of opts.domains ?? []) {
    if (!domains.has(id)) throw new Error(`frame-k: no --records directory for domain ${id}`);
  }
  for (const r of records) {
    if (r.events.some((e) => 'receipt' in e))
      throw new Error(`frame-k: record ${r.callId} carries a verdict`);
  }
  return frameK({
    domains: [...domains.values()],
    records,
    recordSetSha256: sha256Hex(Buffer.concat(bytes)),
    topUpBatches: opts.topUpBatches ?? 0,
  });
}

const USAGE =
  'frame-k --records <dir>[,<dir>...] --out <frame-spec.json> [--domain shop,tracker] [--contracts <file>|shop=<f>,tracker=<f>] [--top-up-batches n] [--report <file>] [--json]';

const command: CliCommandModule = {
  name: 'frame-k',
  describe: 'Compute the H1 FrameSpec (n_F, Clean, N_E, attribution, families, K) from frame records (DET)',
  run(argv) {
    let values: Record<string, string | boolean | string[] | undefined>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          records: { type: 'string', multiple: true },
          out: { type: 'string' },
          domain: { type: 'string' },
          contracts: { type: 'string' },
          'top-up-batches': { type: 'string' },
          report: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      console.error(`${(e as Error).message}\nusage: fiks ${USAGE}`);
      return 2;
    }
    const recordDirs = ((values.records as string[] | undefined) ?? [])
      .flatMap((r) => r.split(','))
      .filter(Boolean);
    if (!recordDirs.length || !values.out) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    try {
      const r = runFrameK({
        records: recordDirs,
        domains: (values.domain as string | undefined)?.split(',').filter(Boolean),
        contracts: values.contracts as string | undefined,
        topUpBatches: values['top-up-batches'] ? Number(values['top-up-batches']) : 0,
      });
      const out = resolve(values.out as string);
      const sha = writeJson(out, r.spec);
      if (values.report) {
        writeJson(resolve(values.report as string), {
          duplicates: r.duplicates,
          notClean: r.notClean,
          ineligible: r.ineligible,
          capability: r.capability,
        });
      }
      const s = r.spec;
      if (values.json)
        console.log(JSON.stringify({ out, sha256: sha, spec: s, notClean: r.notClean.length }));
      else {
        console.log(
          [
            `n_F ${s.nF}; eligible inputs ${s.eligibleInputs.length}; not clean ${r.notClean.length}; duplicates ${r.duplicates.length}`,
            `N_E ${s.NE} of ${s.entities.length} entities; K ${s.K}; crit ${s.crit}; power(0.01) ${s.power.pi01.toFixed(3)}; m ${s.neRule.m}`,
            `record set sha256 ${s.hash}`,
            `wrote ${out} (sha256 ${sha})`,
          ].join('\n'),
        );
      }
      return 0;
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 2;
    }
  },
};

export default command;
