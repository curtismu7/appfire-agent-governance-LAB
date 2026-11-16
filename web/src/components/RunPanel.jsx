import { NEEDS_LABELS, TRACK_LABELS, noIds, notRunText, outcomeState, pickFullPack, ranCount, triggerText } from "../lib";
import { InventedTag, Json, Tag } from "./Bits";
import GatewayTrace from "../gateway-trace/GatewayTrace";

// The one sentence under the "What Privilege did" heading, the same whatever ran (the panel keeps its checked / observed / inferred tags).
const GATEWAY_BASIS = "The gateway's checks, in the order they ran.";

// The honest refusal text for each answer the API can give instead of a run. The server's own detail is shown as it is.
const REFUSAL = {
  vertical_stub: ["Not built", "This vertical is a data stub: it has a name and no pack yet."], // "Pick <the full packs> to run." is added by Refusal, from the loaded list
  live_not_configured: ["Not set up", "The app's .env does not have the PingOne settings yet. Fill .env from .env.example."],
  sign_in_required: ["Sign in first", "This run is made as you: sign in (pi.flow) and run again."],
  live_busy: ["Busy", "Two runs are already in flight. Wait a moment and run again."],
  live_not_allowed: ["Refused", "This run is not allowed on this machine."],
  mock_signin_refused: ["Sign-in refused", "The sign-in checks did not hold."],
  workspace_full: ["Workspace full", "This workspace holds the most runs it keeps. Reset it to continue."],
  network: ["No answer from the server", "The server did not answer. Is it running?"],
};

export function Refusal({ result, verticals }) {
  const code = result.body?.error || `http_${result.status}`;
  const [head, text] = REFUSAL[code] || ["Refused", "The server refused this run."];
  const fallback = code === "vertical_stub" ? `${text} ${pickFullPack(verticals)} to run.` : text;
  const noAnswer = !result.status; // status 0 = the request never got an HTTP answer
  return (
    <div className="panel panel--inner" data-state={result.status === 501 || result.status === 503 ? "warn" : "bad"} role="alert" data-testid="refusal" data-code={code}>
      <h3 className="panel__sub">{head} <Tag state={result.status === 501 || result.status === 503 ? "warn" : "bad"}>{noAnswer ? "no HTTP answer" : `HTTP ${result.status}`}</Tag></h3>
      <p>{result.body?.detail || fallback}</p>
      {result.body?.live?.message && <p className="muted">{result.body.live.message}</p>}
    </div>
  );
}

function Inputs({ uc }) {
  const entries = Object.entries(uc.labInputs || {});
  return (
    <div className="inputs" data-testid="lab-inputs">
      <p className="field-label">Inputs for this run {entries.length ? <InventedTag /> : null}</p>
      {entries.length === 0
        ? <p className="muted">Nothing special: the lab runs the catalog's evidence chain for the everyday read tool and the persona you pick below.</p>
        : <ul className="plain">{entries.map(([k, v]) => <li key={k}><code>{k}</code>: {v !== null && typeof v === "object" ? <Json value={v} label={`Lab input ${k}`} /> : <code>{JSON.stringify(v)}</code>} <InventedTag /></li>)}</ul>}
    </div>
  );
}

// The steps a run that reaches the identity provider only did not run, and why.
function NotRun({ notRun }) {
  return (
    <div className="panel panel--inner" data-state="warn" data-testid="not-run">
      <h3 className="panel__sub">Not run ({notRun.steps.length} step{notRun.steps.length === 1 ? "" : "s"} of this use case)</h3>
      <p>{notRun.reason}</p>
      {notRun.steps.length > 0 && <ol className="plain">{notRun.steps.map((s, i) => <li key={`${s}-${i}`}><code>{s}</code></li>)}</ol>}
    </div>
  );
}

export function RunResult({ run }) {
  const guided = run.kind === "guided";
  const isLive = run.kind === "live";
  const isReal = run.kind === "real";
  return (
    <section className="result" aria-label="Run result" data-testid="result">
      <div className="result__head">
        <Tag state={outcomeState(run.outcome)} testId="outcome">{run.outcome}</Tag>
        {isReal || isLive
          ? null
          : guided
          ? <Tag state="warn" testId="guided-note" title="The lab did not compute this">guided, not computed</Tag>
          : <Tag state={run.matchesExpected ? "ok" : "bad"} testId="matches">{run.matchesExpected ? "matches the catalog label" : "differs from the catalog label"}</Tag>}
        {run.labSimulated && <Tag state="warn">lab-simulated (source says needs-build)</Tag>}
        {!isReal && !isLive && <Tag state="info">persona: {run.persona}</Tag>}
      </div>
      <p data-testid="narration">{run.narration}</p>
      {guided && <p className="muted" data-testid="guided-explain">Guided, not computed: the lab opened the page the product would open and shows the catalog's label ({run.expectedOutcome}). It did not run or verify that outcome.</p>}
      {isLive && <NotRun notRun={run.notRun} />}
      {/* The steps and the tokens are not repeated here: every run, whatever the use case, is read in the evidence column (Sequence, step detail, Tokens). */}
      <p className="muted" data-testid="run-evidence-note">{run.hops?.length ? `${ranCount(run.hops)} hops${notRunText(run.hops)}: read them in the Sequence above (click a step for its detail) and the tokens on the Tokens tab.` : "This run drew no hops."}</p>
      {run.traceparent && <p className="muted">Run traceparent: <code data-testid="run-traceparent">{run.traceparent}</code></p>}
    </section>
  );
}

// The one line a screen reader hears when a run finishes.
const announce = (run) => `${run.useCase?.title || "Run"} finished: ${run.outcome}${run.kind === "real" || run.kind === "live" ? "" : run.kind === "guided" ? ", guided, not computed" : run.matchesExpected ? ", matches the catalog label" : ", differs from the catalog label"}.`;

export default function RunPanel({ uc, vertical, verticals, persona, setPersona, personas, onRun, running, result, mode }) {
  if (!uc) return <section className="panel" data-testid="run-empty"><h2 className="panel__title">Run a use case</h2><p className="muted">Pick a use case on the left. Then choose a vertical pack and a persona, and Run.</p></section>;
  const v = verticals.find((x) => x.id === vertical);
  const stub = v?.pack === "stub";
  return (
    <section className="panel" aria-label="Run a use case" data-testid="run-panel">
      <p className="muted" data-testid="run-track">{TRACK_LABELS[uc.track] || uc.track}</p>
      <h2 className="panel__title" data-testid="run-title">{uc.title}</h2>
      <p>{noIds(uc.buyerStory)}</p>
      <details>
        <summary>What the product does (catalog text, from AI-DEMO2)</summary>
        <p>{noIds(uc.pingOneSolution)}</p>
        <ul className="plain">{Object.entries(uc.productRoles || {}).map(([k, t]) => <li key={k}><strong>{NEEDS_LABELS[k] || k}:</strong> {noIds(t)}</li>)}</ul>
      </details>
      <p className="muted">Trigger in the product: <code>{noIds(triggerText(uc.trigger))}</code></p>
      <p className="muted">Expected outcome (the catalog's label): <Tag state={outcomeState(uc.expectedOutcome)}>{uc.expectedOutcome}</Tag> {uc.tool && <>Tool in this vertical: <code>{uc.tool}</code></>}</p>
      {uc.live?.status === "needs-build" && <p className="muted">{noIds(uc.live.message)}</p>}
      {mode !== "live" && <Inputs uc={uc} />}
      <div className="runbar">
        {mode === "live" && <p className="muted" data-testid="live-persona-note">{uc.realGate?.real ? (uc.id === "UC21" ? "This run uses the person who signed in; the persona is not used. Your tier is your PingOne group: add or remove your user from the premium-tier group in PingOne, Sign out, and sign in again, then run this again." : "This run uses the person who signed in; the persona is not used.") : "This run reaches the identity provider only; the persona is not used."}</p>}
        {mode !== "live" && (
          <label className="field">Persona <InventedTag />
            <select value={persona} onChange={(e) => setPersona(e.target.value)} data-testid="persona">
              {personas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body while the run is in flight. */}
        <button type="button" className="primary" onClick={running ? undefined : onRun} aria-disabled={running ? "true" : undefined} data-testid="run">{running ? "Running..." : "Run"}</button>
      </div>
      {stub && <p className="muted" data-testid="stub-hint">The selected vertical ({v.label}) is a stub. Running it shows the server's honest "not built" answer.</p>}
      {/* The live region says the outcome only; the hop and token dump is not announced. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="run-announce">{result?.ok ? announce(result.body.run) : ""}</p>
      {result && !result.ok && <Refusal result={result} verticals={verticals} />}
      {result?.ok && <RunResult run={result.body.run} />}
      {/* "What Privilege did" (rule 25): the gateway calls of THIS run, under its result. A run that never reached a gateway (a guided page, a refusal before it) has none, so nothing is drawn. */}
      {result?.ok && result.body.run.gatewayTrace?.length > 0 && <GatewayTrace exchanges={result.body.run.gatewayTrace} source={result.body.run.kind === "real" ? "real" : "mock"} basisNote={GATEWAY_BASIS} />}
    </section>
  );
}
