import { DRIFT_NAMES, type DriftStatus, prLabel } from './data.ts';

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 'yes' : 'no'} title={`${label}: ${ok ? 'yes' : 'no'}`}>
      <span aria-hidden="true">{ok ? '✓' : '—'}</span>
      <span className="sr-only">{ok ? 'yes' : 'no'}</span>
    </span>
  );
}

/** One row per seeded vendor change: how far it got through the loop. */
export function DriftTable({
  drifts,
  selected,
  onSelect,
}: {
  drifts: Record<string, DriftStatus>;
  selected?: string;
  onSelect(d: string): void;
}) {
  return (
    <section aria-labelledby="loop-title">
      <h2 id="loop-title">The loop, per vendor change</h2>
      <p className="lede">Select a change to show its timeline below.</p>
      <div className="table-scroll">
        <table className="drifts">
          <thead>
            <tr>
              <th scope="col">Vendor change</th>
              <th scope="col">Detected</th>
              <th scope="col">Repro fails, then passes</th>
              <th scope="col">CI green before PR</th>
              <th scope="col" className="num">
                Violation → PR
              </th>
              <th scope="col">Merged</th>
              <th scope="col">Confirmed</th>
              <th scope="col">Pull request</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(drifts).map(([id, d]) => (
              <tr key={id} className={id === selected ? 'selected' : undefined}>
                <th scope="row">
                  <button type="button" onClick={() => onSelect(id)} aria-pressed={id === selected}>
                    {id} · {DRIFT_NAMES[id] ?? id}
                  </button>
                </th>
                <td data-label="Detected">
                  <Check ok={d.detected} label="detected" />
                </td>
                <td data-label="Repro fails, then passes">
                  <Check ok={d.reproValid} label="repro valid" />
                </td>
                <td data-label="CI green before PR">
                  <Check ok={d.prGreen} label="CI green" />
                </td>
                <td className="num" data-label="Violation → PR">
                  <span data-testid={`minutes-${id}`}>
                    {d.minutesDriftToPr === null ? '—' : `${d.minutesDriftToPr} min`}
                  </span>
                </td>
                <td data-label="Merged">
                  <Check ok={d.merged} label="merged" />
                </td>
                <td data-label="Confirmed">
                  <Check ok={d.confirmed} label="confirmed" />
                </td>
                <td data-label="Pull request">
                  {d.prUrl ? (
                    <a href={d.prUrl} aria-label={d.prUrl.replace(/^https:\/\/github\.com\//, '')}>
                      {prLabel(d.prUrl)}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
