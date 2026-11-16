import { DEMO_GUIDE } from "../demoGuide";

// The session's seven steps as a bar of pills, shown in presenter mode: where you are in the walkthrough, what to say, and the Run buttons for this step.
// It only selects a step and starts runs through the same handler as the demo guide; it holds no state of its own.
export default function AgendaSteps({ step, onStep, onRun, activeUc }) {
  const now = DEMO_GUIDE[step] || DEMO_GUIDE[0];
  const at = DEMO_GUIDE.indexOf(now);
  return (
    <nav className="agenda" aria-label="Demo walkthrough" data-testid="agenda-steps">
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
          {now.ucs.map((b) => (
            <button key={b.uc} type="button" className="primary" onClick={() => onRun?.({ uc: b.uc, stepId: now.id })} aria-pressed={activeUc === b.uc} data-testid={`agenda-run-${b.uc}`}>
              {activeUc === b.uc ? `Running ${b.uc}…` : b.label}
            </button>
          ))}
          <button type="button" onClick={() => onStep(at + 1)} disabled={at >= DEMO_GUIDE.length - 1} data-testid="agenda-next">Next ›</button>
        </div>
      </div>
    </nav>
  );
}
