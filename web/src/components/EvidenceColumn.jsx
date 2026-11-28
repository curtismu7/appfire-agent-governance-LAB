import { Fragment } from "react";
import Working from "./Working";
import SequenceView from "../evidence/SequenceView";
import MovieReel from "../evidence/MovieReel";
import StepDetail from "./StepDetail";
import HopCaption from "./HopCaption";
import DiagramView from "./DiagramView";
import TokenView from "./TokenView";
import { DIAGRAMS, VIEWS, VIEW_LABEL } from "../quickConfig";
import { appsOf, handoffCarry, routeOf } from "../handoff";
import { notRunText, ranCount } from "../lib";
import { HANDOFF_WHY } from "../chat";
import { visible } from "../safeText";
import { GoDeeper } from "./HandoffCard";
import DecisionCard from "./DecisionCard";
import PrivilegePanel from "./PrivilegePanel";

// Why this run went the way it did: how the use case was chosen, then what the run did (chat.js reasoningOf). The chat shows only the reply.
function Why({ steps, testId }) {
  if (!steps?.length) return null;
  return (
    <div className="evwhy" data-testid={testId}>
      <p className="kicker">Why</p>
      <ol className="steps">{steps.map((s, i) => <li key={i}><span className="steps__n">Step {i + 1}</span> {visible(s)}</li>)}</ol>
    </div>
  );
}

// The hand-off summary the evidence column shows while a Hand off use case is selected and has not been previewed.
export function HandoffSummary({ uc, catalog, vertical, userId }) {
  const all = (catalog?.tracks || []).flatMap((t) => t.usecases);
  const n = (f) => all.filter((u) => f(routeOf(u).route)).length;
  const mine = appsOf(routeOf(uc));
  const same = all.filter((u) => routeOf(u).route === "Hand off" && appsOf(routeOf(u)).some((a) => mine.includes(a)));
  return (
    <section className="evsum" aria-label="Hand-off" data-testid="handoff-summary">
      <Why steps={HANDOFF_WHY(uc)} testId="handoff-why" />
      <ul className="card-grid evsum__cards">
        <li className="card card--ok"><h3>Runs here · {n((r) => r === "Here" || r === "Here + go deeper")}</h3><p className="muted">One agent decides.</p></li>
        <li className="card"><h3>Hands off · {n((r) => r === "Hand off")}</h3><p className="muted">Opens its own standalone app, same tab.</p></li>
        <li className="card card--neutral"><h3>Guides · {n((r) => r === "Guide")}</h3><p className="muted">Learning pages and scripts, no lab yet.</p></li>
      </ul>
      <div className="evsum__carry">
        <div>
          <p className="kicker">Carried in the link</p>
          <dl className="kv">
            {(handoffCarry(uc.id, vertical, userId) || []).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}
          </dl>
        </div>
        <div>
          <p className="kicker">Never carried</p>
          <ul className="plain"><li>tokens</li><li>secrets or keys</li><li>cookies</li></ul>
        </div>
      </div>
      <p className="kicker">Everything this lab hands to {mine.map((a, i) => <Fragment key={a}>{i ? " or " : ""}<code>{a}</code></Fragment>)}</p>
      <ul className="evsum__list">{same.map((u) => <li key={u.id} data-current={u.id === uc.id ? "true" : undefined}>{vertical !== "airline" && <><span className="mono">{u.id}</span> </>}{u.title}</li>)}</ul>
      <p className="muted">Open goes in this tab; this chat is kept. This app does not check whether the other one is running (no outbound calls). If it does not load, start it from the Shelf.</p>
    </section>
  );
}

// `children`: the selected use case's panel (inputs, persona, Run and the raw result), at the bottom of the column (owner, 2026-11-09).
export default function EvidenceColumn({ running, run, selHop, onSelect, config, onTab, onFull, vertical, resetSignal, lastRun, uc, catalog, userId, showHandoff, why, children }) {
  const hops = run?.hops || [];
  const tabs = VIEWS.filter((v) => DIAGRAMS.includes(v) || config.views.tokens === "embedded");
  const tab = tabs.includes(config.tab) && (config.tab === "tokens" || config.views[config.tab] === "embedded") ? config.tab : null;
  return (
    <section className="evcol" aria-label="Evidence" data-testid="evidence-column">
      <header className="evcol__head">
        <h2 className="evcol__title"><span className="step-num" aria-hidden="true">2</span>Evidence</h2>
        <span className="muted" data-testid="evidence-count">{run ? `${run.useCase?.title} · ${ranCount(hops)} hops${notRunText(hops)}` : "nothing run yet"}</span>
        <span className="spacer" />
        <button type="button" onClick={() => onFull("compare")} data-testid="open-compare" title="Two runs side by side: what is decided differently">Compare</button>
        <button type="button" onClick={() => onFull("sequence")} data-testid="full-sequence" title="The sequence view on a page of its own">Full page</button>
      </header>
      {running && (
        <div className="evcol__running" data-testid="evidence-running">
          <Working label="Running the use case" />
          <span className="muted">The sequence and the decision are drawn here when the run finishes.</span>
        </div>
      )}
      {showHandoff ? <HandoffSummary uc={uc} catalog={catalog} vertical={vertical} userId={userId} /> : (
        <>
          {run && <DecisionCard run={run} />}
          {run && <PrivilegePanel run={run} />}
          {/* A Here + go deeper use case: the lab that covers this run in depth (moved out of the chat, owner 2026-11-09). */}
          {run && uc && run.useCase?.id === uc.id && <GoDeeper uc={uc} vertical={vertical} userId={userId} />}
          {run && <Why steps={why} testId="evidence-why" />}
          {/* A segmented control, not a second tablist: the page's tabpanel is the agent area itself. Pressed = the view on show. */}
          <div className="evtabs seg" role="group" aria-label="Evidence view" data-testid="evidence-tabs">
            {tabs.map((v) => (
              <button key={v} type="button" aria-pressed={tab === v} aria-controls="evpanel" onClick={() => onTab(v)} data-testid={`evtab-${v}`}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
          {config.presenter && (tab === "sequence" || tab === "reel") && hops.length > 0 && <HopCaption hops={hops} selected={selHop} onSelect={onSelect} />}
          <div id="evpanel" role="region" aria-label={tab ? `${VIEW_LABEL[tab]} view` : "Evidence view"} className="evcol__panel" data-view={tab || "none"}>
            {!tab && <p className="empty-state" data-testid="no-view">No evidence view is embedded. Pick a tab, or turn one on in Quick Config.</p>}
            {tab === "sequence" && <SequenceView hops={hops} selected={selHop} onSelect={onSelect} />}
            {tab === "reel" && <MovieReel hops={hops} selected={selHop} onSelect={onSelect} />}
            {(tab === "sequence" || tab === "reel") && hops.length > 0 && selHop != null && <StepDetail hops={hops} selected={selHop} onSelect={onSelect} onClose={() => onSelect(null)} />}
            {(tab === "sequence" || tab === "reel") && hops.length > 0 && selHop == null && <p className="muted">Click a step, an actor or a tool-call pill for its full detail.</p>}
            {tab === "topology" && <DiagramView vertical={vertical} resetSignal={resetSignal} lastRun={lastRun} />}
            {tab === "tokens" && (
              <div data-testid="evidence-tokens">
                <p className="muted">The tokens this run used, raw and decoded. Client secrets and passwords are never sent to this page.</p>
                {run ? <TokenView tokens={run.tokens} /> : <p className="muted">Run a use case to see its tokens.</p>}
              </div>
            )}
          </div>
        </>
      )}
      {children}
    </section>
  );
}
