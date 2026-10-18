import type { PhaseRow } from './data.ts';

const KINDS = [
  { key: 'correct', label: 'Correct', long: 'Correct answer', icon: '✓', token: 'var(--good)' },
  {
    key: 'declined',
    label: 'Declined',
    long: 'Declined: told the user it could not confirm',
    icon: '!',
    token: 'var(--warning)',
  },
  {
    key: 'noAnswer',
    label: 'No answer',
    long: 'No answer submitted (the trial ended without one)',
    icon: '–',
    token: 'var(--serious)',
  },
  { key: 'wrong', label: 'Wrong', long: 'Wrong answer', icon: '✕', token: 'var(--critical)' },
] as const;

/** Compares the two after-change phases in words, using only their counts. */
function Comparison({ rows }: { rows: PhaseRow[] }) {
  const without = rows.find((r) => r.key === 'B_v2_direct')?.phase.outcomes;
  const withFiks = rows.find((r) => r.key === 'B_v2')?.phase.outcomes;
  if (!without || !withFiks) return null;
  return (
    <p className="lede">
      After the vendor change, with fiks receipts the agent gave <strong>{withFiks.wrong}</strong> wrong
      answers instead of <strong>{without.wrong}</strong>, and declined <strong>{withFiks.declined}</strong>{' '}
      times instead of <strong>{without.declined}</strong>. <strong>{withFiks.noAnswer ?? 0}</strong> trials
      with receipts ended without submitting an answer (<strong>{without.noAnswer ?? 0}</strong> without).
      Declines and missing answers count as failed trials in pass^k.
    </p>
  );
}

/** Where the failed trials went: a confident wrong answer, or a safe "could not confirm". */
export function Outcomes({ rows }: { rows: PhaseRow[] }) {
  return (
    <section aria-labelledby="outcomes-title">
      <h2 id="outcomes-title">What the agent told the user</h2>
      <Comparison rows={rows} />
      <ul className="legend" aria-label="Answer kinds">
        {KINDS.map((k) => (
          <li key={k.key}>
            <span className="status" style={{ background: k.token }} aria-hidden="true">
              {k.icon}
            </span>
            {k.long}
          </li>
        ))}
      </ul>
      <table className="outcomes">
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col" className="num">
              Trials
            </th>
            {KINDS.map((k) => (
              <th scope="col" className="num" key={k.key}>
                {k.label}
              </th>
            ))}
            <th scope="col" className="bar-col">
              <span className="sr-only">Share of trials</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = r.phase.trials || 1;
            return (
              <tr key={r.key}>
                <th scope="row">
                  <span
                    className="swatch"
                    style={{ background: `var(--series-${r.slot})` }}
                    aria-hidden="true"
                  />
                  {r.label}
                </th>
                <td className="num" data-label="Trials">
                  {r.phase.trials}
                </td>
                {KINDS.map((k) => (
                  <td className="num" key={k.key} data-label={k.label}>
                    <span data-testid={`${r.key}-${k.key}`}>{r.phase.outcomes[k.key] ?? 0}</span>
                  </td>
                ))}
                <td className="bar-col">
                  <div
                    className="stack"
                    role="img"
                    aria-label={KINDS.map((k) => `${k.label}: ${r.phase.outcomes[k.key] ?? 0}`).join(', ')}
                  >
                    {KINDS.map((k) =>
                      (r.phase.outcomes[k.key] ?? 0) ? (
                        <span
                          key={k.key}
                          title={`${k.long}: ${r.phase.outcomes[k.key] ?? 0} of ${r.phase.trials}`}
                          style={{ flexGrow: (r.phase.outcomes[k.key] ?? 0) / total, background: k.token }}
                        />
                      ) : null,
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
