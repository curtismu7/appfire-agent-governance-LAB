import { useCallback, useEffect, useRef, useState } from "react";
import SequenceView from "../evidence/SequenceView";
import DecisionCard from "./DecisionCard";
import { Tag } from "./Bits";
import { postJson } from "../api";
import { PRESETS } from "../compare";
import { compareRows } from "../decision";
import { focusHop, newTraceparent, outcomeState } from "../lib";
import { visible } from "../safeText";

const none = () => {};

// Two runs side by side (#compare). Both are run here, fresh, in Mock (`mode: "mock"` is sent on every call), so this page never reaches a real
// tenant even while the lab is in Real. The deciding step is highlighted in each Sequence, the five audit facts are lined up, and the rows that
// differ are marked.
export default function ComparePage({ vertical, onBack }) {
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [sides, setSides] = useState(PRESETS[0].sides.map(() => ({ status: "running" })));
  const seq = useRef(0);

  const runPreset = useCallback(async (p) => {
    const mine = ++seq.current;
    setPresetId(p.id);
    setSides(p.sides.map(() => ({ status: "running" })));
    const answers = await Promise.all(p.sides.map((s) => postJson(`/api/run/${encodeURIComponent(s.uc)}`,
      { vertical, ...(s.persona ? { persona: s.persona } : {}), mode: "mock" }, { traceparent: newTraceparent() })
      .catch(() => ({ ok: false, status: 0, body: {} }))));
    if (mine !== seq.current) return; // a newer comparison took over
    setSides(answers.map((r) => (r.ok ? { status: "done", run: r.body.run } : { status: "error", message: r.body?.detail || r.body?.message || `The server refused this run${r.status ? ` (HTTP ${r.status})` : ""}.` })));
  }, [vertical]);

  useEffect(() => { runPreset(PRESETS.find((p) => p.id === presetId) || PRESETS[0]); }, [vertical]); // eslint-disable-line react-hooks/exhaustive-deps

  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  const [left, right] = sides;
  const rows = left?.run && right?.run ? compareRows(left.run, right.run) : [];

  return (
    <div className="compare" data-testid="page-compare">
      <header className="compare__head">
        <button type="button" className="primary" onClick={onBack} data-testid="back-to-chat">Back to chat</button>
        <h2 className="compare__title">Compare two runs</h2>
        <Tag state="info">Mock, side by side</Tag>
      </header>
      <div className="seg" role="group" aria-label="Comparison" data-testid="compare-presets">
        {PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={p.id === presetId} onClick={() => runPreset(p)} data-testid={`compare-${p.id}`}>{p.title}</button>)}
      </div>
      <p className="muted compare__why" data-testid="compare-why">{preset.why}</p>

      {rows.length > 0 && (
        <div className="compare__scroll">
        <table className="tbl compare__tbl" data-testid="compare-table">
          <thead><tr><th scope="col">What was decided</th><th scope="col">{visible(preset.sides[0].label)}</th><th scope="col">{visible(preset.sides[1].label)}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-diff={r.differs ? "true" : "false"} data-testid={`compare-row-${r.key}`}>
                <th scope="row">{r.label}{r.differs && <span className="compare__flag"> · differs</span>}</th>
                <td>{visible(r.left)}</td>
                <td>{visible(r.right)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="compare__sides">
        {sides.map((s, i) => (
          <section key={`${preset.id}-${i}`} className="compare__side" aria-label={`${preset.sides[i].label}`} data-testid={`compare-side-${i}`}>
            <h3 className="compare__sidehead">
              {s.run ? <>{s.run.useCase?.id} {visible(preset.sides[i].label)} <Tag state={outcomeState(s.run.outcome)}>{s.run.outcome}</Tag></> : visible(preset.sides[i].label)}
            </h3>
            {s.status === "running" && <p className="muted" data-testid="compare-running">Running in Mock...</p>}
            {s.status === "error" && <p className="turn__refused" role="alert" data-testid="compare-error">{visible(s.message)}</p>}
            {s.run && <DecisionCard run={s.run} />}
            {s.run && <SequenceView hops={s.run.hops} selected={focusHop(s.run)} onSelect={none} />}
          </section>
        ))}
      </div>
    </div>
  );
}
