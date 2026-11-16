import { DEMO_GUIDE, TOPICS, buttonKey, guideStep, topicOfStep } from "../demoGuide";

// The session's seven steps as a bar of pills, shown in presenter mode: where you are in the walkthrough, what to say, and the Run buttons for this step.
// It only selects a step and starts runs through the same handler as the demo guide; it holds no state of its own.
export default function AgendaSteps({ step, onStep, onRun, onCompare, activeUc, cast, prompts }) {
  const raw = DEMO_GUIDE[step] || DEMO_GUIDE[0];
  const at = DEMO_GUIDE.indexOf(raw);
  const now = guideStep(raw, { cast, prompts }); // the words for the vertical on screen
  const topic = topicOfStep(raw.id);
  return (
    <nav className="agenda" aria-label="Demo walkthrough" data-testid="agenda-steps">
      <p className="agenda__topicshead">Where we are in the 60 minutes</p>
      <ol className="agenda__topics" data-testid="agenda-topics">
        {TOPICS.map((t) => (
          <li key={t.time} className="agenda__topic" data-current={t === topic ? "true" : undefined} data-testid={`agenda-topic-${t.time.replace(":", "-")}`}>
            {t === topic && <span className="sr-only">Current topic: </span>}
            <span className="agenda__time">{t.time}</span> {t.title}{!t.inLab && <span className="agenda__deck"> (in the deck)</span>}
          </li>
        ))}
      </ol>
      <ol className="agenda__pills">
        {DEMO_GUIDE.map((g, i) => (
          <li key={g.id}>
            <button type="button" className="agenda__pill" aria-current={i === at ? "step" : undefined} onClick={() => onStep(i)} data-testid={`agenda-pill-${g.id}`}>
              <span className="agenda__n">{i + 1}</span> {g.short}
            </button>
          </li>
        ))}
      </ol>
      <div className="agenda__now" data-testid="agenda-now">
        <p className="agenda__title">{now.title}</p>
        <p className="agenda__say">{now.say}</p>
        <div className="agenda__run">
          <button type="button" onClick={() => onStep(at - 1)} disabled={at <= 0} data-testid="agenda-prev">‹ Previous</button>
          {now.ucs.map((b) => (b.compare ? (
            <button key={buttonKey(b)} type="button" className="primary" onClick={() => onCompare?.({ preset: b.compare, stepId: now.id })} data-testid={`agenda-${buttonKey(b)}`}>{b.label}</button>
          ) : (
            <button key={buttonKey(b)} type="button" className="primary" onClick={() => onRun?.({ uc: b.uc, stepId: now.id })} aria-pressed={activeUc === b.uc} data-testid={`agenda-run-${b.uc}`}>
              {activeUc === b.uc ? "Running…" : b.label}
            </button>
          )))}
          <button type="button" onClick={() => onStep(at + 1)} disabled={at >= DEMO_GUIDE.length - 1} data-testid="agenda-next">Next ›</button>
        </div>
      </div>
    </nav>
  );
}
