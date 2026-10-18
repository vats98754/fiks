import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { headlineSlots, type PhaseRow, passHatKSeries, pct } from './data.ts';

const TICK = { fill: 'var(--ink-2)', fontSize: 16 };

/** The one headline: pass^k at the largest k for each phase in order, then pass^k for every k. */
export function Headline({ rows }: { rows: PhaseRow[] }) {
  const data = passHatKSeries(rows);
  const maxK = data.length;
  const tasks = [...new Set(rows.map((r) => r.phase.tasks))].join(' / ');
  const models = [...new Set(rows.map((r) => r.phase.model))].join(', ');
  return (
    <section className="hero" aria-labelledby="headline-title">
      <h1 id="headline-title">
        Shopping tasks where all {maxK} trials succeed <span className="unit">(pass^{maxK})</span>
      </h1>
      <ol className="phases">
        {headlineSlots(rows).map((r) => (
          <li key={r.key} className={r.phase ? undefined : 'pending'}>
            <span className="phase-label">
              <span className="swatch" style={{ background: `var(--series-${r.slot})` }} aria-hidden="true" />
              {r.label}
            </span>
            {r.phase ? (
              <span className="phase-value" data-testid={`pass-${r.key}`}>
                {pct(r.phase.passHatK.at(-1) ?? 0)}
              </span>
            ) : (
              <span className="phase-value">Not run yet</span>
            )}
          </li>
        ))}
      </ol>
      <p className="caption">
        {tasks} fixed tasks, {maxK} trials each, model {models}. pass^k is the chance that all k trials of a
        task succeed, averaged over tasks.
      </p>
      <figure className="chart" aria-label="pass^k for each k, one line per phase">
        <ResponsiveContainer height={260}>
          <LineChart data={data} margin={{ top: 12, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="k"
              tickFormatter={(k) => `k=${k}`}
              stroke="var(--axis)"
              tick={TICK}
              tickMargin={8}
              padding={{ left: 24, right: 24 }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.5, 1]}
              tickFormatter={pct}
              stroke="var(--axis)"
              tick={TICK}
              width={56}
            />
            <Tooltip
              formatter={(v) => pct(Number(v))}
              labelFormatter={(k) => `pass^${k}`}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
                fontSize: 16,
              }}
            />
            {rows.map((r) => (
              <Line
                key={r.key}
                dataKey={r.key}
                name={r.label}
                stroke={`var(--series-${r.slot})`}
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 2, fill: 'var(--surface)' }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <figcaption className="legend">
          <span className="legend-title">pass^k by k:</span>
          {rows.map((r) => (
            <span key={r.key}>
              <span className="swatch" style={{ background: `var(--series-${r.slot})` }} aria-hidden="true" />
              {r.label}
            </span>
          ))}
        </figcaption>
      </figure>
    </section>
  );
}
