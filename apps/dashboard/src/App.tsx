import { useEffect, useMemo, useState } from 'react';
import { DriftTable } from './DriftTable.tsx';
import { type LoopEvent, parseEvents, phaseRows, type Summary, timeline, traceForDrift } from './data.ts';
import { Headline } from './Headline.tsx';
import { Outcomes } from './Outcomes.tsx';
import { Timeline } from './Timeline.tsx';

export function Dashboard({ summary, events }: { summary: Summary; events: LoopEvent[] }) {
  const rows = phaseRows(summary);
  const withPr = Object.entries(summary.drifts).filter(([, d]) => d.prUrl);
  const [drift, setDrift] = useState<string>(withPr[0]?.[0] ?? Object.keys(summary.drifts)[0] ?? '');
  const steps = useMemo(() => {
    const traceId = traceForDrift(events, summary.drifts[drift]?.prUrl ?? null, drift);
    return traceId ? timeline(events, traceId) : [];
  }, [events, summary, drift]);
  return (
    <main>
      <header>
        <p className="brand">fiks</p>
        <p className="lede">
          When a tool silently returns wrong data to an agent, fiks catches it, turns the exact failing call
          into a reproduction test, and opens a pull request that fixes the tool.
        </p>
        <p className="meta">
          <span>
            False positives before the vendor change:{' '}
            <strong data-testid="fp">{summary.falsePositivesV1 ?? '—'}</strong>
          </span>
          <span>
            Source: bench/results/summary.json, generated {summary.generatedAt.slice(0, 16).replace('T', ' ')}{' '}
            UTC
          </span>
        </p>
      </header>
      <Headline rows={rows} />
      <Outcomes rows={rows} />
      <DriftTable drifts={summary.drifts} selected={drift} onSelect={setDrift} />
      <Timeline drift={drift} steps={steps} />
    </main>
  );
}

export function App() {
  const [data, setData] = useState<{ summary: Summary; events: LoopEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      fetch('/data/summary.json').then((r) => r.json() as Promise<Summary>),
      fetch('/data/events.jsonl').then((r) => r.text()),
    ])
      .then(([summary, text]) => setData({ summary, events: parseEvents(text) }))
      .catch((e: unknown) => setError(String(e)));
  }, []);
  if (error) return <main className="state">Could not load data: {error}</main>;
  if (!data) return <main className="state">Loading…</main>;
  return <Dashboard summary={data.summary} events={data.events} />;
}
