import { Fragment } from "react";
import { decisionOf } from "../decision";
import { visible } from "../safeText";

// The one-glance answer to "what happened to that call?": a plain verdict, the reason in the lab's own words, and the five things an
// audit has to name (which agent, on whose behalf, which tool, which policy, what was decided). Read from the run; it decides nothing.
export default function DecisionCard({ run }) {
  const d = decisionOf(run);
  if (!d) return null;
  return (
    <section className="decision" data-tone={d.tone} data-verdict={d.verdict} aria-label="Decision" data-testid="decision-card">
      <p className="decision__word" data-testid="decision-word">{d.word}</p>
      <p className="decision__reason" data-testid="decision-reason">{visible(d.reason)}</p>
      {d.fields.length > 0 && (
        <dl className="kv" data-testid="decision-fields">
          {d.fields.map((f) => (
            <Fragment key={f.key}>
              <dt>{f.label}</dt>
              <dd data-testid={`decision-${f.key}`}>{visible(f.value)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}
