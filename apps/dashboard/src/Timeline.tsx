import { AFTER_PR_STEPS, DRIFT_NAMES, formatOffset, stepLabel, type TimelineStep } from './data.ts';

/** One drift's loop: each step, when it happened relative to the violation, and its evidence. */
export function Timeline({ drift, steps }: { drift: string; steps: TimelineStep[] }) {
  const reachedPr = steps.some((s) => s.type === 'pr_opened');
  const waiting = reachedPr ? AFTER_PR_STEPS.filter((t) => !steps.some((s) => s.type === t)) : [];
  return (
    <section aria-labelledby="timeline-title">
      <h2 id="timeline-title">
        Timeline: {drift} · {DRIFT_NAMES[drift] ?? drift}
      </h2>
      {steps.length === 0 ? (
        <p className="lede">No loop events recorded for this change.</p>
      ) : (
        <ol className="timeline">
          {steps.map((s) => (
            <li key={s.type} className={s.ok === false ? 'fail' : 'ok'}>
              <span className="when">{formatOffset(s.offsetSeconds)}</span>
              <span className="what">
                {s.ok === false ? <span className="sr-only">Failed: </span> : null}
                {s.label}
                {s.url ? (
                  <a className="evidence" href={s.url}>
                    {s.linkText ?? 'evidence'}
                  </a>
                ) : null}
              </span>
              {s.detail ? <span className="detail">{s.detail}</span> : null}
            </li>
          ))}
          {waiting.map((t) => (
            <li key={t} className="pending">
              <span className="when">Not yet</span>
              <span className="what">{stepLabel(t)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
