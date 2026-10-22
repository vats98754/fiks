// Prints a hash of every operator's output over every fixture for a fixed list of seeds. The
// determinism test runs this in separate processes and compares the output.
import { BENIGN_OPS, mutateRecordedResponse, mutationHash, RESPONSE_OPS } from '../src/index.ts';
import { sha256 } from '../src/util.ts';
import fixtures from './fixtures/responses.json' with { type: 'json' };

export const FINGERPRINT_SEEDS: (number | string)[] = [1, 2, 3, 42, 'seed-a'];

export function fingerprint(): { perOp: Record<string, string>; all: string } {
  const perOp: Record<string, string> = {};
  for (const op of [...RESPONSE_OPS, ...BENIGN_OPS]) {
    const hashes: string[] = [];
    for (const [name, ex] of Object.entries(fixtures.exchanges)) {
      for (const seed of FINGERPRINT_SEEDS) {
        const r = mutateRecordedResponse(op, ex.response, seed, ex.request);
        hashes.push(`${name}:${seed}:${mutationHash(r.mutation)}:${sha256(JSON.stringify(r.response))}`);
      }
    }
    perOp[op] = sha256(hashes.join('\n'));
  }
  return { perOp, all: sha256(JSON.stringify(perOp)) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  console.log(JSON.stringify(fingerprint()));
}
