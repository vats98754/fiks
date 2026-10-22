// `fiks freeze-trace` (DET; PLAN 3.0 round 6/7, 7 P20, Appendix `FrozenTrace`).
//
//   fiks freeze-trace --records <dir> --out <trace.json> [--contracts <file>] [--json]
//
// Picks the first call in enumeration order with >= 1 drift-attributable violation (its property
// verifies on the call's v1 control) and writes it in the fiks trace format, keeping the full
// receipt `violated` list and setting `target` = [the first drift-attributable entry]. Next to it,
// `<trace>.iv.json` (never shown to an agent) holds controlCallId, attributableProperties,
// ivProperties (the tool's contract properties that verify on the control) and ivExcluded. A drift
// with no attributable violation is written as {"detected": false} and gets no trace or sidecar.
// A pure function of the record directory and the contracts: reruns give identical bytes.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ContractFile } from '@fiks/contracts';
import { getDomain } from '@fiks/domains';
import {
  attributeCall,
  CALLS_FILE,
  CONTROLS_FILE,
  type DetCallRecord,
  frozenTrace,
  ivSets,
  MANIFEST_FILE,
  type RecordManifest,
  readJsonl,
  sha256Hex,
  sidecarPath,
  writeJson,
} from '@fiks/frame';
import type { CliCommandModule, FrozenTrace } from '@fiks/interfaces';

export interface FreezeResult {
  detected: boolean;
  out: string;
  /** Set when detected. */
  frozen?: FrozenTrace;
  sidecar?: string;
}

export function freezeTrace(opts: { records: string; out: string; contracts?: string }): FreezeResult {
  const dir = resolve(opts.records);
  const out = resolve(opts.out);
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as RecordManifest;
  if (manifest.kind !== 'drift' && manifest.kind !== 'benign') {
    throw new Error(
      `freeze-trace: ${dir} holds ${manifest.kind} records; it needs a --drift or --benign record`,
    );
  }
  const contractsPath = opts.contracts ?? manifest.contracts?.path;
  if (!contractsPath)
    throw new Error('freeze-trace: the records were made without contracts (--monitor none)');
  const contracts = JSON.parse(readFileSync(contractsPath, 'utf8')) as ContractFile;
  const contractOf = (tool: string) => contracts.contracts.find((c) => c.tool === tool);
  const calls = readJsonl<DetCallRecord>(join(dir, CALLS_FILE)).sort((a, b) => a.seq - b.seq);
  const controls = new Map(
    readJsonl<DetCallRecord>(join(dir, CONTROLS_FILE)).map((c) => [c.controlOf as string, c]),
  );
  const driftId = manifest.drift?.id ?? 'unknown';
  const side = sidecarPath(out);

  for (const call of calls) {
    const control = controls.get(call.callId);
    const contract = contractOf(call.tool);
    const a = attributeCall(call, control, contract);
    if (a.attributable.length === 0 || !control) continue;
    const domain = getDomain(manifest.domain);
    const trace = frozenTrace(call, a, {
      driftId,
      serverName: contracts.server || domain.repo.slug.split('/').pop() || manifest.domain,
      serverCommit: manifest.server.commit,
      profile: {
        domain: manifest.domain,
        base: 'v1',
        ruleId: manifest.drift?.ruleId ?? null,
        ruleHash: manifest.drift?.ruleHash ?? null,
      },
      versionHeader: domain.versionHeader,
    });
    const text = `${JSON.stringify(trace, null, 2)}\n`;
    writeFileSync(out, text);
    const traceSha256 = sha256Hex(text);
    const { ivProperties, ivExcluded } = ivSets(control, contract);
    const ivSidecarSha256 = writeJson(side, {
      driftId,
      callId: call.callId,
      controlCallId: control.callId,
      attributableProperties: a.attributable,
      ivProperties,
      ivExcluded,
      traceSha256,
    });
    return {
      detected: true,
      out,
      sidecar: side,
      frozen: {
        driftId,
        callId: call.callId,
        path: out,
        sha256: traceSha256,
        violated: trace.violated,
        target: trace.target,
        controlCallId: control.callId,
        attributableProperties: a.attributable,
        ivProperties,
        ivExcluded,
        ivSidecarSha256,
      },
    };
  }
  writeJson(out, { detected: false, driftId, calls: calls.length });
  if (existsSync(side)) rmSync(side);
  return { detected: false, out };
}

const USAGE = 'freeze-trace --records <dir> --out <trace.json> [--contracts <file>] [--json]';

const command: CliCommandModule = {
  name: 'freeze-trace',
  describe: 'Freeze the first drift-attributable call as the per-drift trace + IV sidecar (DET)',
  run(argv) {
    let values: Record<string, string | boolean | undefined>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          records: { type: 'string' },
          out: { type: 'string' },
          contracts: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      }));
    } catch (e) {
      console.error(`${(e as Error).message}\nusage: fiks ${USAGE}`);
      return 2;
    }
    if (!values.records || !values.out) {
      console.error(`usage: fiks ${USAGE}`);
      return 2;
    }
    try {
      const r = freezeTrace({
        records: values.records as string,
        out: values.out as string,
        contracts: values.contracts as string | undefined,
      });
      if (values.json) console.log(JSON.stringify(r));
      else if (!r.detected)
        console.log(`not detected: no drift-attributable violation; wrote {"detected": false} to ${r.out}`);
      else {
        const f = r.frozen as FrozenTrace;
        console.log(
          [
            `froze ${f.callId} -> ${f.path}`,
            `sha256 ${f.sha256}`,
            `target ${f.target.join(', ')}; violated ${f.violated.map((v) => v.propertyId).join(', ')}`,
            `sidecar ${r.sidecar} sha256 ${f.ivSidecarSha256}`,
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
