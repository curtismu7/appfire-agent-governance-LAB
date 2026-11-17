import { Fragment } from "react";
import { RISK_RUNGS, decisionOf, rungsOf } from "../decision";
import { NUMBER_WORD } from "../fare";
import { visible } from "../safeText";

const breakable = (word) => word.split("_").map((w, i, all) => <Fragment key={w}>{w}{i < all.length - 1 && <>_<wbr /></>}</Fragment>);

// Where the run landed among the controls: four, or five on the airline pack (the rungs come from the run). The rung is named in words ("this run"), never by colour alone.
export function RiskStrip({ level, rungs = RISK_RUNGS }) {
  if (!level) return null;
  const five = rungs.length > RISK_RUNGS.length; // fare: the airline strip, where a word may break after an underscore
  // The four-rung strip is drawn exactly as it always was (no style attribute, the word one string); only the airline strip sets the column count.
  return (
    <ol className={five ? "risk risk--five" : "risk"} aria-label={`Where this run landed among the ${NUMBER_WORD[rungs.length] || rungs.length} controls`} style={five ? { "--risk-n": rungs.length } : undefined} data-testid="risk-strip">
      {rungs.map((r) => (
        <li key={r.level} className="risk__rung" aria-current={r.level === level ? "step" : undefined} data-testid={`risk-${r.level}`}>
          <span className="risk__n">{r.level}</span> {r.control}
          <span className="risk__word">{five ? <>{r.level === level ? "this run · " : ""}{breakable(r.word)}</> : r.level === level ? `this run · ${r.word}` : r.word}</span>
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
      {d.steer && <p className="decision__steer" data-testid="decision-steer">{visible(d.steer)}</p>}
      <p className="decision__reason" data-testid="decision-reason">{visible(d.reason)}</p>
      <RiskStrip level={d.level} rungs={rungsOf(run)} />
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
