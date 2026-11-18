import { useState } from "react";
import FloatingDialog from "../floating-dialog/FloatingDialog";
import { DEMO_GUIDE, guideStep } from "../demoGuide";
import { promptOfCase, runLabelOfCase } from "../demoCases";

// The talk track as a draggable dialog with a Pop out (owner 2026-11-13): put it on the second monitor while demoing.
// The pop-out is a live same-origin window (FloatingDialog's); the tab keeps the dialog open.
// With `cases` (the airline pack's eight, owner 2026-11-18) the dialog has a list of them on the left: a click picks one, the right side shows what the agenda
// requires, the words to type, what the page will show, the talking points and the links into the lab, and one button runs it. The whole talk track follows below.
export default function TalkTrack({ talk, onRun, activeUc, onClose, cases = null, cast = null, prompts = [], onCase, onLink }) {
  const [at, setAt] = useState(0);
  const run = (uc) => { const step = talk.find((t) => (t.run || []).some((r) => r.uc === uc)); onRun?.(step, uc); };
  const hasCases = Array.isArray(cases) && cases.length > 0;
  const c = hasCases ? cases[Math.min(at, cases.length - 1)] : null;
  const stepAt = c ? DEMO_GUIDE.findIndex((g) => g.id === c.stepId) : -1;
  const step = stepAt >= 0 ? guideStep(DEMO_GUIDE[stepAt], { cast, prompts }) : null;
  const prompt = c ? promptOfCase(c, prompts) : null;
  const running = c && c.uc && activeUc === c.uc;
  return (
    <FloatingDialog isOpen noBackdrop onClose={onClose} title="Talk track" ariaLabel="Talk track"
      defaultWidth={hasCases ? 980 : 560} defaultHeight={hasCases ? 770 : 720} defaultY={hasCases ? 110 : null} placement="right" storageKey="aag.talktrack" testId="talk-track-dialog">
      {hasCases && (
        <div className="cases" data-testid="talk-cases">
          <nav className="cases__list" aria-label="The eight cases">
            <ol>
              {cases.map((k, i) => (
                <li key={k.id}>
                  <button type="button" className="cases__pick" aria-current={i === at ? "true" : undefined} onClick={() => setAt(i)} data-testid={`case-pick-${k.id}`}>
                    <span className="cases__n">{i + 1}</span> {k.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section className="cases__detail" aria-live="polite" data-testid="case-detail" data-case={c.id}>
            <h3 className="cases__title">{at + 1} · {c.title}</h3>
            {step && (
              <p className="cases__req" data-testid="case-requirement">
                <span className="cases__label">The requirement (agenda step {stepAt + 1})</span>
                {step.req}
              </p>
            )}
            <p className="cases__prompt" data-testid="case-prompt">
              <span className="cases__label">{prompt ? "Type this" : "Press"}</span>
              {prompt ? <q>{prompt}</q> : (c.compare ? "Open Compare at this pair" : "Open Run history")}
            </p>
            <p className="cases__explain" data-testid="case-explain"><span className="cases__label">What happens</span>{c.explain}</p>
            <p className="cases__show" data-testid="case-show"><span className="cases__label">What the page shows</span>{c.show}</p>
            <div className="cases__say" data-testid="case-say">
              <span className="cases__label">Say</span>
              <ul>{c.say.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <p className="cases__actions">
              <button type="button" className="primary" onClick={() => onCase?.(c)} aria-pressed={running ? "true" : undefined} data-testid="case-run">{running ? "Running…" : runLabelOfCase(c)}</button>
              {c.links.map((l) => (
                <button key={l.label} type="button" className="talk__run" onClick={() => onLink?.(l, c)} data-testid={`case-link-${l.kind}${l.preset ? `-${l.preset}` : ""}`}>{l.label}</button>
              ))}
            </p>
            <p className="cases__step">
              <button type="button" onClick={() => setAt(Math.max(0, at - 1))} disabled={at <= 0} data-testid="case-prev">‹ Previous case</button>
              <button type="button" onClick={() => setAt(Math.min(cases.length - 1, at + 1))} disabled={at >= cases.length - 1} data-testid="case-next">Next case ›</button>
            </p>
          </section>
        </div>
      )}
      {hasCases && <h3 className="cases__all">The whole talk track</h3>}
      <ol className="talk" data-testid="talk-track">
        {talk.map((t) => (
          <li key={t.id}>
            <h3>{t.title}</h3>
            <p>{t.say}</p>
            {(t.run || []).length > 0 && (
              <p className="talk__runs" data-testid={`talk-runs-${t.id}`}>
                {t.run.map((r) => (
                  <button key={r.uc} type="button" className="talk__run" onClick={() => run(r.uc)} data-testid={`talk-run-${r.uc}`} aria-pressed={activeUc === r.uc}>{r.label}</button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </FloatingDialog>
  );
}
