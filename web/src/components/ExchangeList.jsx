import { useState } from "react";
import { Json } from "./JsonPane";
import { statusState } from "./HttpMessage";
import { visible } from "../safeText";
import { HOT_CALL } from "../lib";
import { exchangesOf, openByDefault, tokenSummary } from "../exchanges";

// The calls of a gateway step, one card each (owner, 2026-11-16: the generic Form view nested a box per item and repeated the whole token and every
// header on every call). A card's line says what was asked and what came back; the detail opens on a click. The token is one chip, collapsed: what it
// says is shown on a click, the whole token under that. A header the same as the call before is stated once; an empty argument list has no row.
// The call's raw JSON is the shared Form | JSON pane (Rule 24), open under every opened card (owner, 2026-11-16: the pane must be on the page, not behind a click). Reads the hop only; decides nothing.
const flip = (set, n) => { const s = new Set(set); if (s.has(n)) s.delete(n); else s.add(n); return s; };
const CLAIM_ROWS = [["sub", (c) => c.sub], ["act.sub", (c) => c.act?.sub], ["aud", (c) => c.aud], ["scope", (c) => c.scope], ["client_id", (c) => c.client_id]];
const show = (v) => (Array.isArray(v) ? v.join(" ") : v);
const lifetime = (c) => (typeof c.exp === "number" && typeof c.iat === "number" ? `${Math.max(1, Math.round((c.exp - c.iat) / 60))} minutes` : null);

function TokenChip({ token, open, onToggle, id }) {
  if (!token) return <span className="xch__muted">none sent</span>;
  const rows = token.claims ? [...CLAIM_ROWS.map(([k, f]) => [k, f(token.claims)]), ["lifetime", lifetime(token.claims)]].filter(([, v]) => v !== undefined && v !== null && v !== "") : [];
  return (
    <>
      <button type="button" className="xch__tok" aria-expanded={open} aria-controls={id} onClick={onToggle} title="Show what the token says">
        <span className="xch__mono">Bearer {token.raw.slice(0, 10)}…</span>
        <span>{visible(tokenSummary(token.claims))}</span>
      </button>
      {open && (
        <div id={id} className="xch__claims">
          {rows.map(([k, v]) => <div key={k} className="xch__claim"><span className="xch__muted">{k}</span><span className="xch__mono">{visible(show(v))}</span></div>)}
          <div className="xch__claim"><span className="xch__muted">token</span><span className="xch__mono xch__whole">{token.raw}</span></div>
        </div>
      )}
    </>
  );
}

function Headers({ e }) {
  const row = ([k, v]) => <div key={k} className="xch__kv"><span className="xch__muted">{visible(k)}</span><span className="xch__mono">{visible(v)}</span></div>;
  return (
    <>
      {e.changedHeaders.map(row)}
      {e.sameHeaders.length > 0 && (
        <details className="xch__more">
          <summary>{e.sameHeaders.length} more {e.sameHeaders.length === 1 ? "header" : "headers"}, same as call {e.sameHeadersAs}</summary>
          {e.sameHeaders.map(row)}
        </details>
      )}
    </>
  );
}

function Detail({ e, tokOpen, onTok }) {
  return (
    <div className="xch__detail">
      <div className="xch__col">
        <h5 className="xch__h">Request</h5>
        <div className="xch__kv"><span className="xch__muted">Token</span><span><TokenChip token={e.token} open={tokOpen} onToggle={onTok} id={`xch-tok-${e.n}`} /></span></div>
        <div className="xch__kv"><span className="xch__muted">Asked</span><span className="xch__chip" data-kind="tool">{visible(e.rpc)}{e.tool ? ` · ${visible(e.tool)}` : ""}</span></div>
        {e.args && <div className="xch__kv"><span className="xch__muted">Arguments</span><span className="xch__items">{Object.entries(e.args).map(([k, v]) => <span key={k} className="xch__chip xch__mono">{visible(k)} = {visible(typeof v === "string" ? v : JSON.stringify(v))}</span>)}</span></div>}
        <Headers e={e} />
      </div>
      <div className="xch__col">
        <h5 className="xch__h">Response{e.status !== null ? ` · ${e.status}` : ""}</h5>
        <div className="xch__kv"><span className="xch__muted">Result</span><span>{visible(e.result)}</span></div>
        {e.items.length > 0 && <div className="xch__kv"><span className="xch__muted">{e.items.length > 3 ? "Listed" : "Items"}</span><span className="xch__items">{e.items.map((i) => <span key={i} className="xch__chip xch__mono">{visible(i)}</span>)}</span></div>}
        <details className="xch__more" open>
          <summary>Raw JSON</summary>
          <Json value={e.raw} label={`Call ${e.n} raw`} hot={HOT_CALL} />
        </details>
      </div>
    </div>
  );
}

export function ExchangeList({ request, response }) {
  const list = exchangesOf({ request, response });
  const [open, setOpen] = useState(() => openByDefault(list));
  const [tok, setTok] = useState(() => new Set());
  return (
    <div className="xch">
      <div className="xch__bar">
        <span className="xch__muted">{list.filter((e) => open.has(e.n)).length} of {list.length} calls open</span>
        <button type="button" className="xch__link" onClick={() => setOpen(new Set(list.map((e) => e.n)))}>Open all</button>
        <button type="button" className="xch__link" onClick={() => setOpen(new Set())}>Close all</button>
      </div>
      {list.map((e) => {
        const isOpen = open.has(e.n);
        return (
          <article key={e.n} className="xch__card" data-open={isOpen} data-testid={`xch-${e.n}`}>
            <button type="button" className="xch__row" aria-expanded={isOpen} onClick={() => setOpen(flip(open, e.n))}>
              <span className="xch__n">{e.n}</span>
              <span className="xch__what">
                <span className="xch__chip" data-kind="method">{visible(e.method)}</span>
                <span className="xch__mono">{visible(e.path)}</span>
                <span className="xch__rpc">{visible(e.rpc)}</span>
                {e.tool && <span className="xch__chip xch__mono" data-kind="tool">{visible(e.tool)}</span>}
                <span className="xch__muted">{visible(e.result)}</span>
              </span>
              <span className="xch__chip" data-kind="status" data-state={e.status === null ? "bad" : statusState(e.status)}>{e.status === null ? "no answer" : e.status}</span>
              <span className="xch__caret" aria-hidden="true">▶</span>
            </button>
            {isOpen && <Detail e={e} tokOpen={tok.has(e.n)} onTok={() => setTok(flip(tok, e.n))} />}
          </article>
        );
      })}
    </div>
  );
}
