// Per-property verdicts of every record in a calls.jsonl, one JSON line per record:
//   tsx verdict-map.ts <calls.jsonl> <contracts.json> <out.jsonl> [--live]
// Offline (default): MON's replay (now := capturedAt) through the contract evaluator, mapped by
// DET's compare rule. --live: the receipts the log-only proxy logged during `record`.
// Run with and without the clock-shift preload to show the system clock is never read.
import { readFileSync, writeFileSync } from 'node:fs';
import type { ContractFile } from '@fiks/contracts';
import { contractsMonitor, readRecords, replayAll } from '@fiks/proxy';
import { type DetCallRecord, hasProbe, perPropertyVerdicts, readJsonl, verdictsOf } from '../../src/index.ts';

const [file, contractsFile, out, mode] = process.argv.slice(2) as [string, string, string, string?];
const contracts = JSON.parse(readFileSync(contractsFile, 'utf8')) as ContractFile;
const contractOf = (tool: string) => contracts.contracts.find((c) => c.tool === tool);
const records = readJsonl<DetCallRecord>(file);
const lines: string[] = [];
if (mode === '--live') {
  for (const r of records)
    lines.push(JSON.stringify({ callId: r.callId, verdicts: verdictsOf(r, contractOf(r.tool)) }));
} else {
  const { records: replay } = readRecords([file], { domain: 'shop', stratum: 'frame' });
  const run = await replayAll(replay, { monitor: contractsMonitor(), contracts });
  run.replayed.forEach((x, i) => {
    const rec = records[i] as DetCallRecord;
    if (rec.callId !== x.record.callId) throw new Error(`order mismatch at ${i}`);
    lines.push(
      JSON.stringify({
        callId: rec.callId,
        verdicts: perPropertyVerdicts(x.evaluation, contractOf(rec.tool), { probeRecorded: hasProbe(rec) }),
      }),
    );
  });
}
writeFileSync(out, `${lines.join('\n')}\n`);
