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

// The Real-mode help (owner 2026-11-13): what runs Real (each signs in first) and what cannot run Real, with the fixed
// reason. Built from the same catalog the picker uses, so it can never drift from the gate.
function RealHelp({ catalog, onRun, activeUc }) {
  const all = catalog?.tracks.flatMap((t) => t.usecases) || [];
  const real = all.filter((u) => u.realGate?.real);
  const blocked = all.filter((u) => u.realGate && !u.realGate.real);
  const run = (id) => { const u = all.find((x) => x.id === id); if (u) onRun?.({ uc: id, u }); };
  return (
    <section data-testid="guide-real-help">
      <h3 className="guide__title">Real mode: what runs, what is blocked</h3>
      <p className="muted">Real mode runs real only — nothing falls back to the mock engine. {real.length} use cases run the live chain (PingOne sign-in, token exchange, the SE Agent Gateway, PingOne Authorize, the tool); each one asks you to sign in the first time. The other {blocked.length} are blocked in Real mode, each with its reason.</p>
      <h4 className="guide__subhead">Runs Real — sign-in required ({real.length})</h4>
      <ul className="guide__list" data-testid="guide-real-list">
        {real.map((u) => (
          <li key={u.id}>
            <button type="button" className="guide__runlink" onClick={() => run(u.id)} data-testid={`guide-real-${u.id}`} aria-pressed={activeUc === u.id}>{u.id} · {u.title}</button>
          </li>
        ))}
        {real.length === 0 && <li className="muted">Loading the catalog…</li>}
      </ul>
      <h4 className="guide__subhead">Blocked in Real ({blocked.length})</h4>
      <ul className="guide__list guide__list--blocked" data-testid="guide-blocked-list">
        {blocked.map((u) => (
          <li key={u.id}><strong>{u.id}</strong> · {u.title} — {u.realGate.reason}</li>
        ))}
        {blocked.length === 0 && <li className="muted">Loading the catalog…</li>}
      </ul>
    </section>
  );
}

export default function DemoGuide({ isOpen, onClose, onRun, activeUc, catalog }) {
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="Appfire demo guide" ariaLabel="Step-by-step demo guide"
      defaultWidth={460} defaultHeight={640} placement="right" storageKey="aag.guide" testId="demo-guide">
      <div className="stack">
        <p className="muted" data-testid="guide-intro">Eight steps, one per requirement in the Appfire Agentic AI Demo Brief. Everything the customer sees here is customer-safe: ask for, proof, talking point.</p>
        {DEMO_GUIDE.map((s) => <Step key={s.id} step={s} onRun={onRun} activeUc={activeUc} />)}
        <RealHelp catalog={catalog} onRun={onRun} activeUc={activeUc} />
      </div>
    </FloatingDialog>
  );
}
