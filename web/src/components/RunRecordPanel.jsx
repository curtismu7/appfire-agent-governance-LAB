// The lab's wrapper around the vendored "What each layer logged for this run" panel (run-observability/RunObservability.jsx, never edited).
// It takes the run's answer from POST /api/run, reads the record once with GET /api/run-observability/:runId, and shows it as Mock (the lab's own engine
// computed every row). A Real run has no record: the panel says so. A stale record is never shown while the new one loads, and any answer that is not a
// record is an alert, never the empty state.
import { useEffect, useState } from "react";
import RunObservability from "../run-observability/RunObservability.jsx";
import { getJson } from "../api";

const isRecord = (b, runId) => !!b && typeof b === "object" && !Array.isArray(b) && b.runId === runId && Array.isArray(b.rows)
  && !!b.coverage && typeof b.coverage === "object" && b.source === "mock";

// Pure: never throws, whatever the answer is (null, [], a string, {} or a non-record object).
export function stateOf(runId, answer) {
  if (answer.status === "answer") return isRecord(answer.body, runId) ? { status: "ready", record: answer.body } : { status: "alert" };
  if (answer.code === 404) return { status: "none" };
  return { status: "alert" };
}

export default function RunRecordPanel({ result }) {
  if (!result || !result.ok) return null;
  const runId = typeof result.body?.observability?.runId === "string" ? result.body.observability.runId : null;
  if (!runId) {
    return <p className="muted" data-testid="run-record-none">No record for this run: this run's record is not built.</p>;
  }
  return <Loaded key={runId} runId={runId} />;
}

function Loaded({ runId }) {
  const [state, setState] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    getJson(`/api/run-observability/${encodeURIComponent(runId)}`).then(
      (body) => ({ status: "answer", body }),
      (e) => ({ status: "error", code: e?.status }),
    ).then((answer) => { if (live) setState(stateOf(runId, answer)); });
    return () => { live = false; };
  }, [runId, attempt]);

  if (state.status === "loading") return <p className="muted" role="status" data-testid="run-record-loading">Collecting the run's record...</p>;
  if (state.status === "none") return <p className="muted" data-testid="run-record-gone">No record of this run is held in this mode any more.</p>;
  if (state.status === "alert") {
    return (
      <div className="ro-error" role="alert" data-testid="run-record-alert">
        <strong>The run's record could not be read.</strong>{" "}
        <button type="button" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
      </div>
    );
  }
  return (
    <section data-testid="run-record" aria-label="Run record">
      <RunObservability record={state.record} source="mock" />
    </section>
  );
}
