import { captionFor } from "../captions";
import { DEMO_GUIDE } from "../demoGuide";
import { withSkipped } from "../evidence/lanes";
import { visible } from "../safeText";

// Presenter mode only: what to say, and what to point at, for the step selected in the Sequence, with Previous / Next to walk the run one step at a
// time. It reads the hop and the selection and holds no state; the words are in captions.js.
export default function HopCaption({ hops, selected, onSelect }) {
  const ran = withSkipped(hops, false);
  const h = hops.find((x) => x.n === selected) || null;
  if (!ran.length) return null;
  if (!h) {
    return (
      <aside className="cap" aria-label="Presenter caption" data-testid="hop-caption">
        <p className="cap__say">Walk through this run one step at a time: what to say, and what to point at.</p>
        <div className="cap__nav"><button type="button" className="primary" onClick={() => onSelect(ran[0].n)} data-testid="caption-start">Start with step {ran[0].n} ›</button></div>
      </aside>
    );
  }
  const order = withSkipped(hops, h.verdict === "skip");
  const at = order.indexOf(h);
  const prev = order[at - 1], next = order[at + 1];
  const c = captionFor(h);
  const step = c.agenda ? DEMO_GUIDE.findIndex((g) => g.id === c.agenda) : -1;
  return (
    <aside className="cap" aria-label="Presenter caption" aria-live="polite" data-testid="hop-caption">
      <p className="cap__head">
        <strong>Step {h.n} · {visible(h.title)}</strong>
        {step >= 0 && <span className="cap__chip" data-testid="caption-agenda">Walkthrough {step + 1} · {DEMO_GUIDE[step].short}</span>}
        {c.notInPath && <span className="cap__chip" data-state="info">NOT RUN</span>}
      </p>
      <p className="cap__say" data-testid="caption-say">{c.say}</p>
      <p className="cap__point"><strong>Point at:</strong> {c.point}</p>
      <div className="cap__nav">
        <button type="button" onClick={() => prev && onSelect(prev.n)} disabled={!prev} data-testid="caption-prev">‹ Previous</button>
        <span className="muted">{at + 1} of {order.length}</span>
        <button type="button" className="primary" onClick={() => next && onSelect(next.n)} disabled={!next} data-testid="caption-next">Next ›</button>
      </div>
    </aside>
  );
}
