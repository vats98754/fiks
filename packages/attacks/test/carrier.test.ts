import { describe, expect, it } from 'vitest';
import { availableCarriers, CARRIERS, placePayload } from '../src/carrier.ts';
import { makeTrace } from './support.ts';

const PAYLOAD = 'INJECT-MARKER-12345';

describe('carrier placer', () => {
  it('does not mutate the base trace', () => {
    const base = makeTrace();
    const before = JSON.stringify(base);
    placePayload(base, PAYLOAD, 'response-body-append');
    expect(JSON.stringify(base)).toBe(before);
  });

  it('appends the payload to the last response body', () => {
    const t = placePayload(makeTrace(), PAYLOAD, 'response-body-append');
    expect(t.http.at(-1)?.response.body).toContain(PAYLOAD);
  });

  it('adds the payload as a JSON field', () => {
    const t = placePayload(makeTrace(), PAYLOAD, 'response-body-field');
    const parsed = JSON.parse(t.http.at(-1)?.response.body ?? '{}');
    expect(parsed._vendor_notice).toBe(PAYLOAD);
  });

  it('places into a violation message', () => {
    const t = placePayload(makeTrace(), PAYLOAD, 'violation-message');
    expect(t.violated[0]?.message).toContain(PAYLOAD);
  });

  it('places into a probe response body', () => {
    const t = placePayload(makeTrace(), PAYLOAD, 'probe-response-body');
    expect(t.probe?.http.at(-1)?.response.body).toContain(PAYLOAD);
  });

  it('smuggles into a string tool argument', () => {
    const t = placePayload(makeTrace(), PAYLOAD, 'tool-args');
    expect(JSON.stringify(t.args)).toContain(PAYLOAD);
  });

  it('reports available carriers for a trace with a probe', () => {
    expect(availableCarriers(makeTrace()).sort()).toEqual([...CARRIERS].sort());
  });

  it('throws for a carrier with no slot', () => {
    const noProbe = makeTrace({ probe: undefined });
    expect(availableCarriers(noProbe)).not.toContain('probe-response-body');
    expect(() => placePayload(noProbe, PAYLOAD, 'probe-response-body')).toThrow();
  });
});
