import FloatingDialog from "../floating-dialog/FloatingDialog";
import { DEMO_GUIDE } from "../demoGuide";

// The step-by-step demo guide (owner request 2026-11-12): a pop-out tooltip beside the demo. One card per requirement in
// the Appfire brief, each with what was asked (req), how the lab proves it (prove, with a Run button wired to the use case)
// and the customer-safe talking points (say). Floats over the demo, drag-anywhere, and can pop out to its own window so the
// presenter can put it on a second screen.
function Step({ step, onRun, activeUc }) {
  return (
    <article className="guide__step" data-testid={`guide-step-${step.id}`}>
      <h3 className="guide__title">{step.title}</h3>
      <p className="guide__row"><span className="guide__tag">Asked for</span>{step.req}</p>
      <p className="guide__row"><span className="guide__tag">How we prove it</span>{step.prove}</p>
      <p className="guide__row"><span className="guide__tag guide__tag--say">Say</span>{step.say}</p>
      {step.uc && (
        <button type="button" className="guide__run" onClick={() => onRun?.(step)} data-testid={`guide-run-${step.uc}`} aria-pressed={activeUc === step.uc}>
          {activeUc === step.uc ? `Running ${step.uc}…` : `Run ${step.uc} now`}
        </button>
      )}
    </article>
  );
}

export default function DemoGuide({ isOpen, onClose, onRun, activeUc }) {
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="Appfire demo guide" ariaLabel="Step-by-step demo guide"
      defaultWidth={460} defaultHeight={640} placement="right" storageKey="aag.guide" testId="demo-guide">
      <div className="stack">
        <p className="muted" data-testid="guide-intro">Eight steps, one per requirement in the Appfire Agentic AI Demo Brief. Everything the customer sees here is customer-safe: ask for, proof, talking point.</p>
        {DEMO_GUIDE.map((s) => <Step key={s.id} step={s} onRun={onRun} activeUc={activeUc} />)}
      </div>
    </FloatingDialog>
  );
}
