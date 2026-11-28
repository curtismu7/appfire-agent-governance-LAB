import SequenceView from "../evidence/SequenceView";
import MovieReel from "../evidence/MovieReel";
import StepDetail from "./StepDetail";
import UseCasePicker from "./UseCasePicker";
import { outcomeState } from "../lib";
import { Tag } from "./Bits";
import { useCallback, useEffect } from "react";

// Drag the divider to resize the use-case list; the width persists.
function useSideResize(key) {
  const onHandleDown = useCallback((e) => {
    e.preventDefault();
    const grid = e.target.closest(".fullpage");
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const move = (ev) => {
      ev.preventDefault();
      const w = Math.min(Math.max(ev.clientX - rect.left, 180), rect.width * 0.45);
      grid.style.setProperty("--side-w", `${w}px`);
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        const w = parseFloat(getComputedStyle(grid).getPropertyValue("--side-w"));
        if (w) localStorage.setItem(key, String(w));
      } catch { /* none */ }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }, [key]);
  return onHandleDown;
}

const runnable = (u) => !u.guided;

// The Sequence and Movie reel pages (#sequence, #reel): the chat is hidden so the room sees the diagram, the conversation is kept. A slim list
// of the use cases that draw a diagram (picking one runs it), a big diagram on top, the step detail below.
export default function FullPageEvidence({ page, onPage, onBack, catalog, selectedId, onPickRun, run, running, selHop, onSelect, verticalSelect, failed }) {
  const hops = run?.hops || [];
  const title = page === "reel" ? "Movie reel" : "Sequence";
  const onHandleDown = useSideResize("ag.sideW");
  useEffect(() => {
    try {
      const w = parseFloat(localStorage.getItem("ag.sideW"));
      if (w) document.querySelector(".fullpage")?.style.setProperty("--side-w", `${w}px`);
    } catch { /* none */ }
  }, [page]);
  return (
    <div className="fullpage" data-testid={`page-${page}`}>
      <aside className="fullpage__side" aria-label="Use cases with a diagram">
        <button type="button" className="primary fullpage__back" onClick={onBack} data-testid="back-to-chat">Back to chat</button>
        <p className="muted">The chat is hidden on this page so the diagram gets the room. Your conversation is kept.</p>
        {verticalSelect}
        <UseCasePicker catalog={catalog} selectedId={selectedId} onPick={onPickRun} keep={runnable} slim failed={failed} label="Use cases with a diagram" />
        <p className="muted">Hand-offs and guides have no diagram here, so they are not listed. Picking a use case runs it.</p>
      </aside>
      <div className="col-handle" role="separator" aria-orientation="vertical" aria-label="Resize use-case list" onPointerDown={onHandleDown} />
      <section className="fullpage__main" aria-label={`${title}, full page`}>
        <header className="fullpage__head">
          <h2 className="fullpage__title">{run ? `${run.useCase?.title}` : title}</h2>
          {/* Live sequence (owner 2026-11-28): while the run streams in, the outcome tag waits for the finished run. */}
          {run && !running && <Tag state={outcomeState(run.outcome)} testId="full-outcome">{run.outcome}</Tag>}
          {running && <Tag state="info">running</Tag>}
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Diagram">
            <button type="button" aria-pressed={page === "sequence"} onClick={() => onPage("sequence")} data-testid="full-tab-sequence">Sequence</button>
            <button type="button" aria-pressed={page === "reel"} onClick={() => onPage("reel")} data-testid="full-tab-reel">Movie reel</button>
          </div>
        </header>
        {!run && <p className="muted" data-testid="full-empty">Nothing has run yet. Pick a use case on the left: it runs and draws here.</p>}
        {run && (page === "reel" ? <MovieReel hops={hops} selected={selHop} onSelect={onSelect} /> : <SequenceView hops={hops} selected={selHop} onSelect={onSelect} />)}
        {running && run && hops.length > 0 && <p className="muted" data-testid="full-live-note">Drawing the run live: {hops.length} hop{hops.length === 1 ? "" : "s"} so far.</p>}
        {run && selHop != null && <StepDetail hops={hops} selected={selHop} onSelect={onSelect} onClose={() => onSelect(null)} />}
      </section>
    </div>
  );
}
