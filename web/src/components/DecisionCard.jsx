import { Fragment } from "react";
import { RISK_RUNGS, decisionOf } from "../decision";
import { visible } from "../safeText";

// Where the run landed among the four controls. The rung is named in words ("this run"), never by colour alone.
export function RiskStrip({ level }) {
  if (!level) return null;
  return (
    <ol className="risk" aria-label="Where this run landed among the four controls" data-testid="risk-strip">
      {RISK_RUNGS.map((r) => (
        <li key={r.level} className="risk__rung" aria-current={r.level === level ? "step" : undefined} data-testid={`risk-${r.level}`}>
          <span className="risk__n">{r.level}</span> {r.control}
          <span className="risk__word">{r.level === level ? `this run · ${r.word}` : r.word}</span>
        </li>
      ))}
    </ol>
  );
}

// The one-glance answer to "what happened to that call?": a plain verdict, the reason in the lab's own words, and the five things an
// audit has to name (which agent, on whose behalf, which tool, which policy, what was decided). Read from the run; it decides nothing.
export default function DecisionCard({ run }) {
  const d = decisionOf(run);
  if (!d) return null;
  return (
    <section className="decision" data-tone={d.tone} data-verdict={d.verdict} aria-label="Decision" data-testid="decision-card">
      <p className="decision__word" data-testid="decision-word">{d.word}</p>
      <p className="decision__reason" data-testid="decision-reason">{visible(d.reason)}</p>
      <RiskStrip level={d.level} />
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
