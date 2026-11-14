import FloatingDialog from "../floating-dialog/FloatingDialog";

// The talk track as a draggable dialog with a Pop out (owner 2026-11-13): put it on the second monitor while demoing.
// The pop-out is a live same-origin window (FloatingDialog's); the tab keeps the dialog open.
export default function TalkTrack({ talk, onRun, activeUc }) {
  const run = (uc) => { const step = talk.find((t) => (t.run || []).some((r) => r.uc === uc)); onRun?.(step, uc); };
  return (
    <FloatingDialog isOpen onClose={() => { window.location.hash = "#agent"; }} title="Talk track" ariaLabel="Talk track"
      defaultWidth={560} defaultHeight={720} placement="right" storageKey="aag.talktrack" testId="talk-track-dialog">
      <ol className="talk" data-testid="talk-track">
        {talk.map((t) => (
          <li key={t.id}>
            <h3>{t.title}</h3>
            <p>{t.say}</p>
            {(t.run || []).length > 0 && (
              <p className="talk__runs" data-testid={`talk-runs-${t.id}`}>
                {t.run.map((r) => (
                  <button key={r.uc} type="button" className="guide__runlink" onClick={() => run(r.uc)} data-testid={`talk-run-${r.uc}`} aria-pressed={activeUc === r.uc}>{r.label}</button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </FloatingDialog>
  );
}
