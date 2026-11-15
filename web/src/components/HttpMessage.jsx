import { Tag } from "./Bits";
import { Json } from "./JsonPane";
import { visible } from "../safeText";

// One request or response of a hop, shown in parts (owner, 2026-11-14): the start line (method and address, or HTTP status) in a colour that
// says what it is, then the headers, query and body as the same Formatted form / coloured Raw panes as everywhere else. A message that is not
// shaped like HTTP (a list of sign-in steps, a list of gateway calls) is shown whole in one pane.
const METHOD_STATE = { GET: "info", HEAD: "info", POST: "ok", PUT: "warn", PATCH: "warn", DELETE: "bad" };
export const statusState = (n) => (n >= 500 ? "bad" : n === 401 || n === 403 ? "bad" : n >= 400 ? "warn" : n >= 300 ? "info" : "ok");
const HTTP_KEYS = ["method", "url", "status", "headers", "body", "query"];
const present = (v) => v !== undefined && v !== null && !(typeof v === "object" && Object.keys(v).length === 0);

export function HttpMessage({ msg, label }) {
  if (!present(msg)) return null;
  if (typeof msg !== "object") return <Json value={String(msg)} label={label} />;
  if (!HTTP_KEYS.some((k) => k in msg)) return <Json value={msg} label={label} />;
  const { method, url, status, headers, body, query, ...rest } = msg;
  return (
    <div className="http" role="group" aria-label={label}>
      {(method || url || status != null) && (
        <p className="http__line">
          {method && <Tag state={METHOD_STATE[String(method).toUpperCase()] || "info"}>{visible(String(method))}</Tag>}
          {url && <span className="http__url">{visible(String(url))}</span>}
          {status != null && <Tag state={statusState(Number(status))}>HTTP {visible(String(status))}</Tag>}
        </p>
      )}
      {present(query) && <><p className="http__h">Query</p><Json value={query} label={`${label} query`} toggle={false} /></>}
      {present(headers) && <><p className="http__h">Headers</p><Json value={headers} label={`${label} headers`} toggle={false} /></>}
      {present(body) && <><p className="http__h">Body</p><Json value={body} label={`${label} body`} /></>}
      {present(rest) && <Json value={rest} label={`${label} more`} toggle={false} />}
    </div>
  );
}

// ---- Key facts: the few things a reader looks for in a step, pulled out and coloured ---------------------------------------------------------
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/;
function claimsOf(raw) {
  try {
    const t = raw.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    return c && typeof c === "object" && !Array.isArray(c) ? c : null;
  } catch { return null; }
}
// Every JWT in a value, in reading order (bounded: a hop is small, but a hostile shape must not run away).
function tokensIn(v, out = [], depth = 0) {
  if (out.length >= 8 || depth > 8) return out;
  if (typeof v === "string") { const m = /(?:Bearer |DPoP )?(eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*)/.exec(v); if (m && JWT.test(m[1])) out.push(m[1]); return out; }
  if (Array.isArray(v)) { for (const x of v) tokensIn(x, out, depth + 1); return out; }
  if (v && typeof v === "object") for (const x of Object.values(v)) tokensIn(x, out, depth + 1);
  return out;
}
const statusesIn = (res) => (res && typeof res === "object" ? [res.status, ...(Array.isArray(res.calls) ? res.calls.map((c) => c?.status) : [])].filter((n) => Number.isFinite(n)) : []);

export function factsOf(hop) {
  const facts = [];
  const sts = [...new Set(statusesIn(hop.response))];
  for (const n of sts.slice(0, 3)) facts.push({ kind: statusState(n), label: "HTTP", value: String(n) });
  if (hop.decision?.outcome) facts.push({ kind: /^permit/i.test(hop.decision.outcome) ? "ok" : /^deny/i.test(hop.decision.outcome) ? "bad" : "warn", label: "decision", value: String(hop.decision.outcome) });
  // The result of the hop first (its response), then what it was given (its request): the first claim of each kind wins.
  const seen = new Set();
  for (const raw of [...tokensIn(hop.response), ...tokensIn(hop.request)]) {
    const c = claimsOf(raw);
    if (!c) continue;
    const add = (kind, label, value) => { if (value !== undefined && value !== null && value !== "" && !seen.has(label)) { seen.add(label); facts.push({ kind, label, value: String(value) }); } };
    add("act", "act.sub", c.act && typeof c.act === "object" ? c.act.sub : undefined);
    add("sub", "sub", c.sub);
    add("aud", "aud", Array.isArray(c.aud) ? c.aud.join(" ") : c.aud);
    add("scope", "scope", c.scope);
  }
  return facts;
}

export function KeyFacts({ hop }) {
  const facts = factsOf(hop);
  if (!facts.length) return null;
  return (
    <ul className="facts" aria-label="Key facts of this step" data-testid="key-facts">
      {facts.map((f, i) => <li key={`${f.label}-${i}`} className="fact" data-kind={f.kind}><span className="fact__k">{f.label}</span><span className="fact__v">{visible(f.value)}</span></li>)}
    </ul>
  );
}
