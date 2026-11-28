import { Fragment, useEffect, useRef, useState } from "react";
import { outcomeState, pickFullPack, verticalName } from "../lib";
import { routeOf } from "../handoff";
import { Tag } from "./Bits";
import Turn from "./Turn";
import { followNewest } from "../follow";
import { Spin } from "./Working";
import { DEMO_GUIDE, promptGroups, promptsOfStep } from "../demoGuide";
import { narrowedChip } from "../fare";

const STATUS = { idle: ["Ready", "info"], running: ["Running", "info"], waiting: ["Waiting for you", "warn"], handoff: ["Ready to hand off", "info"], done: ["Done", "ok"], refused: ["Refused", "bad"] };

// "Banking · AeroGuard Platform": the vertical's name, then its brand when that says something more.
export const verticalHeading = (id, label) => {
  const name = verticalName(id);
  return label && label.toLowerCase() !== name.toLowerCase() ? `${name} · ${label}` : name || label || "";
};
const opensApp = (p) => p.route === "Hand off";

// What to type, per vertical: always visible above the input (owner rule). The prompts that run here come first; the ones whose use case opens
// its own app sit in their own group. A stub vertical says it has no demo pack yet.
// Prompt picker (UI standard amendment 2, owner 2026-11-28): the prompts render as a dropdown above the composer,
// not a chip wall — a collapsed select listing every prompt (grouped by walkthrough step via optgroups; Presenter
// mode narrows to the current step). Picking an entry keeps the chip's fill → flash → send path (typeAndSend).
export function WhatToType({ prompts, vertical, verticalLabel, verticals, stub, typeAndSend, disabled, step = null, onNextStep, fare = false }) {
  const heading = verticalHeading(vertical, verticalLabel);
  const at = step ? DEMO_GUIDE.findIndex((g) => g.id === step.id) : -1;
  const mine = step ? promptsOfStep(step.id, prompts, { fare }) : [];
  const { groups, more } = promptGroups(prompts, { fare });
  const pickerList = step ? mine : [...groups.flatMap((g) => g.items), ...more];
  return (
    <section className="wtt" aria-label={`What to type, ${heading}`} data-testid="what-to-type">
      <p className="kicker" data-testid="wtt-heading">What to type · {step ? `Step ${at + 1} · ${step.short} · ${heading}` : heading}</p>
      {stub ? <p className="muted" data-testid="wtt-stub">{heading}: no demo pack yet. {pickFullPack(verticals)} to chat.</p> : prompts.length === 0 ? <p className="muted">Loading the prompts…</p> : (
        <>
          <div className="wtt__picker" data-testid="wtt-picker">
            <label className="sr-only" htmlFor="wtt-select">Pick a prompt</label>
            <select id="wtt-select" value="" disabled={disabled} aria-label={`Pick a prompt, ${heading}`} data-testid="wtt-select"
              onChange={(e) => { const p = prompts.find((x) => x.uc === e.target.value); if (p) { typeAndSend(p.text, "chip"); e.target.value = ""; } }}>
              <option value="" disabled>{step ? `Prompts for step ${at + 1} (${mine.length})` : `Pick a prompt (${pickerList.length})`}</option>
              {step ? mine.map((p) => <option key={p.uc} value={p.uc}>{p.text}</option>) : groups.map((g) => (
                <optgroup key={g.id} label={`${g.n} · ${g.short}`}>
                  {g.items.map((p) => <option key={p.uc} value={p.uc}>{p.text}</option>)}
                </optgroup>
              ))}
              {!step && more.some((p) => !opensApp(p)) && (
                <optgroup label="More prompts">
                  {more.filter((p) => !opensApp(p)).map((p) => <option key={p.uc} value={p.uc}>{p.text}</option>)}
                </optgroup>
              )}
              {!step && more.some(opensApp) && (
                <optgroup label="Opens its own app">
                  {more.filter(opensApp).map((p) => <option key={p.uc} value={p.uc}>{p.text}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          {step && (
            <div className="wtt__nav" data-testid="wtt-step"><button type="button" onClick={onNextStep} disabled={at >= DEMO_GUIDE.length - 1} data-testid="wtt-next">{at >= DEMO_GUIDE.length - 1 ? "Last step" : `Next step: ${DEMO_GUIDE[at + 1]?.short} ›`}</button></div>
          )}
        </>
      )}
    </section>
  );
}

// First open: the agent's name and four starter cards from the vertical's prompts.
function Starters({ agent, brand, prompts, typeAndSend, stub, step = null, person = "customer", fare = false }) {
  const list = step ? promptsOfStep(step.id, prompts, { fare }) : prompts.filter((p) => !opensApp(p));
  return (
    <div className="starters" data-testid="starters">
      <span className="avatar avatar--agent avatar--big" aria-hidden="true">AI</span>
      <h2 className="starters__title"><span className="step-num" aria-hidden="true">1</span>{agent || "The agent"} at {brand || "the demo company"}</h2>
      <p className="muted">{`Type what a ${person} would say. Each prompt runs one use case and the evidence column draws every hop.`}</p>
      {!stub && (
        <ul className="starters__grid">
          {list.slice(0, 4).map((p) => (
            <li key={p.uc}>
              <button type="button" className="starter" onClick={() => typeAndSend(p.text, "starter")} data-testid={`starter-${p.uc}`}>
                <Tag state={outcomeState(p.expectedOutcome)}>{p.expectedOutcome}</Tag>
                <b>{p.text}</b>
                <span className="muted">{p.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Several-agent and in-depth use cases open their own app (marked "Opens" in the list).</p>
    </div>
  );
}

export default function AgentColumn({ agent, brand, userId, vertical, verticalLabel, verticals, stub, prompts, turns, status, onSay, onHop, onPreview, running, instructions, step = null, onNextStep, person = "customer", fare = false }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  // Keep the newest reply in view: inside the chat box, and the page too when the (twice as tall) column runs below the window (follow.js).
  useEffect(() => {
    const box = endRef.current?.parentElement;
    followNewest(box, box?.querySelector(".turn:last-child"));
  }, [turns.length, turns[turns.length - 1]?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [word, state] = STATUS[status] || STATUS.idle;
  const [sending, setSending] = useState(false);
  const sendTimer = useRef(null);
  useEffect(() => () => clearTimeout(sendTimer.current), []);
  const send = (e) => { e.preventDefault(); if (!text.trim() || running) return; onSay(text, "typed"); setText(""); };
  // A prompt chip fills the composer and "sends" visibly (owner 2026-11-13): the text appears, the composer flashes,
  // then the same send path runs. The flash is short enough that scripted tests waiting ~300ms still see the run.
  const typeAndSend = (value, source) => {
    if (running || sending || !value) return;
    setText(value);
    setSending(true);
    sendTimer.current = setTimeout(() => {
      setSending(false);
      onSay(value, source);
      setText("");
    }, 260);
  };
  return (
    <section className="agentcol" aria-label="Agent" data-testid="agent-column" data-talking={turns.length ? "true" : undefined}>
      <header className="agentcol__head">
        <span className="avatar avatar--agent" aria-hidden="true">AI</span>
        <p className="agentcol__who"><b>{agent || "agent"}</b> acting for {userId || "the customer"} · {brand || verticalLabel}</p>
        <Tag state={state} testId="agent-status">{status === "running" && <Spin small />}{word}</Tag>
      </header>
      <div className="agentcol__scroll">
        {turns.length === 0 ? <Starters agent={agent} brand={brand} prompts={prompts} typeAndSend={typeAndSend} stub={stub} step={step} person={person} fare={fare} /> : (
          <ol className="turns" aria-label="Conversation" data-testid="turns">
            {turns.map((t) => {
              const chip = t.result?.ok ? narrowedChip(t.result.body.run) : null; // fare: a narrowed booking is never silent
              return (
                <Fragment key={t.id}>
                  <Turn turn={t} onHop={onHop} onPreview={onPreview} userId={userId} running={running} />
                  {chip && <li className="narrowed" data-testid="turn-narrowed"><Tag state="info">{chip}</Tag></li>}
                </Fragment>
              );
            })}
          </ol>
        )}
        <div ref={endRef} />
      </div>
      <div className="agentcol__foot">
        {instructions}
        <WhatToType prompts={prompts} vertical={vertical} verticalLabel={verticalLabel} verticals={verticals} stub={stub} typeAndSend={typeAndSend} disabled={running} step={step} onNextStep={onNextStep} fare={fare} />
      </div>
      <div className="agentcol__compose">
        <form className={`composer${sending ? " composer--sending" : ""}`} onSubmit={send}>
          <label className="sr-only" htmlFor="composer-input">Message the agent</label>
          <input id="composer-input" type="text" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder={stub ? "No demo pack for this vertical yet" : `Type what a ${person} would say`} autoComplete="off" data-testid="composer-input" />
          <button type="submit" className="primary" aria-disabled={running || !text.trim() ? "true" : undefined} data-testid="composer-send">Send</button>
        </form>
      </div>
    </section>
  );
}

export const statusOf = (turn) => {
  if (!turn) return "idle";
  if (turn.status === "running") return "running";
  if (turn.status === "nomatch") return "idle";
  const res = turn.result;
  if (res && !res.ok) return "refused";
  if (!res && turn.uc && routeOf(turn.uc).route === "Hand off") return "handoff";
  const o = res?.body?.run?.outcome;
  if (o === "STEP_UP" || o === "HITL_REQUIRED" || o === "CIBA") return "waiting";
  return res ? "done" : "idle";
};
