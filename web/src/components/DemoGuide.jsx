import FloatingDialog from "../floating-dialog/FloatingDialog";
import { DEMO_GUIDE, buttonKey, guideStep } from "../demoGuide";

// The step-by-step demo guide (owner request 2026-11-12): a pop-out tooltip beside the demo. One card per requirement in
// the Appfire brief, each with what was asked (req), how the lab proves it (prove, with a Run button wired to the use case)
// and the customer-safe talking points (say). Floats over the demo, drag-anywhere, and can pop out to its own window so the
// presenter can put it on a second screen.
function Step({ step, onRun, onCompare, activeUc }) {
  return (
    <article className="guide__step" data-testid={`guide-step-${step.id}`}>
      <h3 className="guide__title">{step.title}</h3>
      <p className="guide__row"><span className="guide__tag">The step</span>{step.req}</p>
      <p className="guide__row"><span className="guide__tag">How the lab shows it</span>{step.prove}</p>
      <p className="guide__row"><span className="guide__tag guide__tag--say">Say</span>{step.say}</p>
      {step.ucs.map((b) => (b.compare ? (
        <button key={buttonKey(b)} type="button" className="guide__run" onClick={() => onCompare?.({ preset: b.compare, stepId: step.id })} data-testid={`guide-${buttonKey(b)}`}>{b.label}</button>
      ) : (
        <button key={buttonKey(b)} type="button" className="guide__run" onClick={() => onRun?.({ uc: b.uc, stepId: step.id })} data-testid={`guide-run-${step.id}-${b.uc}`} aria-pressed={activeUc === b.uc}>
          {activeUc === b.uc ? "Running…" : b.label}
        </button>
      )))}
    </article>
  );
}

export default function DemoGuide({ isOpen, onClose, onRun, onCompare, activeUc, catalog, cast, prompts }) {
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="Appfire demo guide" ariaLabel="Step-by-step demo guide"
      defaultWidth={460} defaultHeight={640} placement="right" storageKey="aag.guide" testId="demo-guide">
      <div className="stack">
        <p className="muted" data-testid="guide-intro">Seven steps, the demo walkthrough from the session agenda: one agent workflow from request to audit record. Each has what it is, how the lab shows it, and what to say.</p>
        {DEMO_GUIDE.map((s) => <Step key={s.id} step={guideStep(s, { cast, prompts })} onRun={onRun} onCompare={onCompare} activeUc={activeUc} />)}
      </div>
    </FloatingDialog>
  );
}
