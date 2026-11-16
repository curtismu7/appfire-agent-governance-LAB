import FloatingDialog from "../floating-dialog/FloatingDialog";
import { DEMO_GUIDE, buttonKey, guideStep } from "../demoGuide";
import { REAL_VERTICAL_NOTE } from "../lib";

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

// The Real-mode help (owner 2026-11-13; fallback 2026-11-16): what runs Real (each signs in first) and what runs on the labelled mock engine in Real mode, with the fixed
// reason. Built from the same catalog the picker uses, so it can never drift from the gate.
function RealHelp({ catalog, onRun, activeUc }) {
  const all = catalog?.tracks.flatMap((t) => t.usecases) || [];
  const real = all.filter((u) => u.realGate?.real);
  const blocked = all.filter((u) => u.realGate && !u.realGate.real);
  const run = (id) => { const u = all.find((x) => x.id === id); if (u) onRun?.({ uc: id, u }); };
  return (
    <section data-testid="guide-real-help">
      <h3 className="guide__title">Real mode: what runs Real, what runs Mock</h3>
      <p className="muted" data-testid="guide-real-vertical">{REAL_VERTICAL_NOTE}</p>
      {real.length === 0 && blocked.length > 0 ? (
        <p className="muted" data-testid="guide-real-none">No use case runs the live chain in this vertical. In Real mode all {blocked.length} run on the mock engine, each for the reason shown: every hop says MOCK and the card says so.</p>
      ) : (
        <>
          <p className="muted">{real.length} use cases run the live chain in Real mode (PingOne sign-in, token exchange, the SE Agent Gateway, PingOne Authorize, the tool); each one asks you to sign in the first time. The other {blocked.length} cannot run Real, each for the reason shown, so in Real mode they run on the mock engine: every hop says MOCK and the card says so.</p>
          <h4 className="guide__subhead">Runs Real — sign-in required ({real.length})</h4>
          <ul className="guide__list" data-testid="guide-real-list">
            {real.map((u) => (
              <li key={u.id}>
                <button type="button" className="guide__runlink" onClick={() => run(u.id)} data-testid={`guide-real-${u.id}`} aria-pressed={activeUc === u.id}>{u.title}</button>
              </li>
            ))}
            {real.length === 0 && <li className="muted">Loading the catalog…</li>}
          </ul>
        </>
      )}
      <h4 className="guide__subhead">Runs Mock in Real mode ({blocked.length})</h4>
      <ul className="guide__list guide__list--blocked" data-testid="guide-blocked-list">
        {blocked.map((u) => (
          <li key={u.id}>{u.title} — {u.realGate.reason}</li>
        ))}
        {blocked.length === 0 && <li className="muted">Loading the catalog…</li>}
      </ul>
    </section>
  );
}

export default function DemoGuide({ isOpen, onClose, onRun, onCompare, activeUc, catalog, cast, prompts }) {
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="Appfire demo guide" ariaLabel="Step-by-step demo guide"
      defaultWidth={460} defaultHeight={640} placement="right" storageKey="aag.guide" testId="demo-guide">
      <div className="stack">
        <p className="muted" data-testid="guide-intro">Seven steps, the demo walkthrough from the session agenda: one agent workflow from request to audit record. Each has what it is, how the lab shows it, and what to say.</p>
        {DEMO_GUIDE.map((s) => <Step key={s.id} step={guideStep(s, { cast, prompts })} onRun={onRun} onCompare={onCompare} activeUc={activeUc} />)}
        <RealHelp catalog={catalog} onRun={onRun} activeUc={activeUc} />
      </div>
    </FloatingDialog>
  );
}
