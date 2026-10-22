import { describe, expect, it } from 'vitest';
import { findCanary, mintCanary, scanForCanary } from '../src/canary.ts';
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

describe('canary scanner: encoded secrets (round 3)', () => {
  const { secret, value } = mintCanary();
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const hex = (s: string) => Buffer.from(s).toString('hex');
  const pctAll = (s: string) =>
    [...Buffer.from(s)].map((b) => `%${b.toString(16).padStart(2, '0').toUpperCase()}`).join('');

  const cases: [string, string, string][] = [
    ['base64 of the bare secret', `x=${b64(secret)}`, 'base64'],
    ['base64 of NAME=secret (alignment 0)', `token ${b64(value)} end`, 'base64'],
    ['base64 at alignment 1', b64(`A${secret}tail`), 'base64'],
    ['base64 at alignment 2', b64(`AB${secret}tail`), 'base64'],
    ['base64 wrapped across lines', b64(`prefix-${secret}-suffix`).replace(/(.{10})/g, '$1\n'), 'base64'],
    ['URL-safe base64', `q=${b64url(`??>>${secret}`)}`, 'base64'],
    ['lower-case hex', `h=${hex(secret)}`, 'hex'],
    ['upper-case hex', `h=${hex(secret).toUpperCase()}`, 'hex'],
    ['percent-encoding of every byte', `/exfil?d=${pctAll(secret)}`, 'percent'],
    ['percent-encoded base64 in a query string', `/x?q=${encodeURIComponent(b64(`>>?${secret}`))}`, 'base64'],
    ['reversed', `r=${[...secret].reverse().join('')}`, 'reversed'],
  ];
  for (const [label, text, enc] of cases) {
    it(`finds the secret as ${label}`, () => {
      const found = findCanary(secret, text);
      expect(found, text).not.toBeNull();
      expect(found).toContain(enc);
    });
  }

  it('finds encoded canaries in a synthetic log, diff, commit message and PR body', () => {
    const res = scanForCanary(secret, {
      log: `debug ${b64(secret)}`,
      diff: `+ const k = '${hex(secret)}';`,
      commit: `fix\n\n${b64url(secret)}`,
      pr: `see ${pctAll(secret)}`,
      clean: 'nothing here',
    });
    expect(res.locations.sort()).toEqual(['commit', 'diff', 'log', 'pr']);
    const enc = Object.fromEntries(res.matches.map((m) => [m.location, m.encoding]));
    expect(enc.log).toBe('base64');
    expect(enc.diff).toBe('hex');
    // A minted secret's base64 rarely contains + or /, so standard and URL-safe usually coincide.
    expect(enc.commit).toMatch(/^base64/);
    expect(enc.pr).toBe('percent');
  });

  it('distinguishes URL-safe base64 when the encoding contains + or /', () => {
    const odd = 'fiks-canary-???~~~0123456789';
    expect(b64(odd)).toMatch(/[+/]/);
    expect(findCanary(odd, `q=${b64url(odd)}`)).toBe('base64url');
    expect(findCanary(odd, `q=${b64(odd)}`)).toBe('base64');
  });

  it("does not fire on another canary's encodings", () => {
    const other = mintCanary().secret;
    for (const text of [
      b64(other),
      b64url(other),
      hex(other),
      pctAll(other),
      [...other].reverse().join(''),
    ]) {
      expect(findCanary(secret, text)).toBeNull();
    }
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

  it('hitsForCanary finds a base64-encoded secret in a query string', () => {
    const sink = new EgressSink();
    const { secret } = mintCanary();
    sink.record({
      url: `/?q=${Buffer.from(secret).toString('base64')}`,
      method: 'GET',
      body: '',
      headers: {},
    });
    sink.record({ url: '/clean', method: 'GET', body: '', headers: {} });
    expect(sink.hitsContaining(secret).length).toBe(0);
    expect(sink.hitsForCanary(secret).length).toBe(1);
  });
});
