export default function TalkTrack({ talk, onRun, activeUc }) {
  const run = (uc) => { const step = talk.find((t) => (t.run || []).some((r) => r.uc === uc)); onRun?.(step, uc); };
  return (
    <section className="panel" aria-label="Talk track">
      <h2 className="panel__title">Talk track</h2>
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
    </section>
  );
}
