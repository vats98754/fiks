import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Dashboard } from '../src/App.tsx';
import {
  formatOffset,
  parseEvents,
  passHatKSeries,
  pct,
  phaseRows,
  type Summary,
  timeline,
} from '../src/data.ts';

const summary = JSON.parse(
  readFileSync(new URL('./fixture/summary.json', import.meta.url), 'utf8'),
) as Summary;
const events = parseEvents(readFileSync(new URL('./fixture/events.jsonl', import.meta.url), 'utf8'));

test('phase rows keep reading order and fixed color slots', () => {
  const rows = phaseRows(summary);
  expect(rows.map((r) => [r.key, r.slot])).toEqual([
    ['A_v1', 1],
    ['B_v2_direct', 2],
    ['B_v2', 3],
  ]);
  expect(passHatKSeries(rows)[1]).toEqual({ k: 2, A_v1: 1, B_v2_direct: 0.5, B_v2: 0.25 });
});

test('rendered numbers equal the fixture values', () => {
  const html = renderToStaticMarkup(<Dashboard summary={summary} events={events} />);
  for (const r of phaseRows(summary)) {
    expect(html).toContain(`data-testid="pass-${r.key}">${pct(r.phase.passHatK.at(-1) ?? 0)}<`);
    expect(html).toContain(`data-testid="${r.key}-wrong">${r.phase.outcomes.wrong}<`);
  }
  expect(html).toContain(`data-testid="fp">${summary.falsePositivesV1}<`);
  expect(html).toContain(`data-testid="minutes-D2">${summary.drifts.D2?.minutesDriftToPr} min<`);
  expect(html).toContain('vats98754/shop-mcp/pull/1');
});

test('timeline: steps in loop order with offsets from the violation', () => {
  const steps = timeline(events, 'tr_fixture01');
  expect(steps.map((s) => s.type)).toEqual(['violation', 'gate_F', 'gate_local', 'gate_ci', 'pr_opened']);
  expect(steps.map((s) => formatOffset(s.offsetSeconds))).toEqual([
    '+0s',
    '+12s',
    '+1m 05s',
    '+1m 30s',
    '+1m 34s',
  ]);
  expect(steps[2]?.ok).toBe(true); // the passing attempt is the one shown
});
