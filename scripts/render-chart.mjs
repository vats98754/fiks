#!/usr/bin/env node
// Renders docs/chart.svg (pass^k by k, one line per bench phase) from bench/results/summary.json.
// The README shows this file; no number in it is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const summary = JSON.parse(readFileSync(join(root, 'bench/results/summary.json'), 'utf8'));
const PHASES = [
  ['A_v1', 'Before the vendor change', '#2a78d6'],
  ['B_v2_direct', 'After the change, without fiks', '#eb6834'],
  ['B_v2', 'After the change, with fiks receipts', '#1baf7a'],
  ['C_v2_fixed', 'After the fiks PRs were merged', '#c98500'],
  ['C_v2_prheads', 'With the fiks PR branches', '#c98500'],
].filter(([k]) => summary.phases[k]);

const W = 720;
const H = 360;
const pad = { l: 56, r: 24, t: 24, b: 120 };
const maxK = Math.max(...PHASES.map(([k]) => summary.phases[k].passHatK.length));
const x = (k) => pad.l + ((k - 1) / Math.max(1, maxK - 1)) * (W - pad.l - pad.r);
const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
const pct = (v) => `${Math.round(v * 100)}%`;

const out = [];
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13" role="img" aria-labelledby="t"><title id="t">pass^k by k for each bench phase (from bench/results/summary.json)</title>`,
);
out.push(`<rect width="${W}" height="${H}" fill="#fcfcfb"/>`);
for (const v of [0, 0.25, 0.5, 0.75, 1]) {
  out.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e1e0d9"/>`);
  out.push(`<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" fill="#898781">${pct(v)}</text>`);
}
for (let k = 1; k <= maxK; k++) {
  out.push(`<text x="${x(k)}" y="${H - pad.b + 20}" text-anchor="middle" fill="#898781">pass^${k}</text>`);
}
PHASES.forEach(([key, label, color], i) => {
  const vals = summary.phases[key].passHatK;
  out.push(
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${vals.map((v, j) => `${x(j + 1)},${y(v)}`).join(' ')}"/>`,
  );
  for (const [j, v] of vals.entries())
    out.push(
      `<circle cx="${x(j + 1)}" cy="${y(v)}" r="4" fill="#fcfcfb" stroke="${color}" stroke-width="2"/>`,
    );
  const last = vals.at(-1);
  const ly = H - pad.b + 44 + i * 18;
  out.push(`<rect x="${pad.l}" y="${ly - 10}" width="12" height="12" rx="3" fill="${color}"/>`);
  out.push(
    `<text x="${pad.l + 18}" y="${ly}" fill="#0b0b0b">${label}: pass^${vals.length} = ${pct(last)} (${summary.phases[key].trials} trials)</text>`,
  );
});
out.push('</svg>');
writeFileSync(join(root, 'docs/chart.svg'), `${out.join('\n')}\n`);
console.log(`[render-chart] docs/chart.svg from ${PHASES.length} phases`);
