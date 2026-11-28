import { workspaceFetch } from "./workspace";

export async function getJson(url) {
  const r = await workspaceFetch(url, { method: "GET" });
  if (!r.ok) {
    let body = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return r.json();
}

// POST or PUT JSON. Returns { ok, status, body }: a refusal (400, 403, 409, 501) is data (a code and a detail), not an exception.
export async function sendJson(method, url, payload, headers = {}) {
  const r = await workspaceFetch(url, { method, body: JSON.stringify(payload), headers });
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, body };
}
export const postJson = (url, payload, headers) => sendJson("POST", url, payload, headers);
export const putJson = (url, payload) => sendJson("PUT", url, payload);

// Stream a run live (owner 2026-11-28). Posts with stream:true; the server answers text/x-ndjson for a full Real run:
// one {type:"hop", hop} line per finished hop, then the ordinary answer as one {type:"done", ...} line (or
// {type:"error", error, detail} for a refusal after hops began). Anything else (a JSON refusal before the stream,
// a mock run, an old server) arrives as one JSON document and is returned exactly like postJson.
// onHop fires with each hop as it lands, before the final result resolves.
export async function postJsonStream(url, payload, headers = {}, onHop = null) {
  const r = await workspaceFetch(url, { method: "POST", body: JSON.stringify({ ...payload, stream: true }), headers });
  const type = String(r.headers?.get?.("content-type") || "");
  if (!type.includes("text/x-ndjson")) {
    let body = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, body };
  }
  const reader = r.body?.getReader?.();
  if (!reader) return { ok: false, status: r.status, body: { error: "network", detail: "The server did not answer. Is it running?" } };
  const decoder = new TextDecoder();
  let buf = "";
  let done = null;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let evt = null;
      try { evt = JSON.parse(line); } catch { /* a partial line: skipped */ }
      if (!evt || typeof evt !== "object") continue;
      if (evt.type === "hop" && evt.hop && onHop) { try { onHop(evt.hop); } catch { /* a bad callback never breaks the run */ } }
      else if (evt.type === "done") { const { type, ...rest } = evt; done = { ok: true, status: 200, body: { ok: true, ...rest } }; }
      else if (evt.type === "error") done = { ok: false, status: 200, body: { error: evt.error || "live_refused", detail: evt.detail || "" } };
    }
  }
  return done || { ok: false, status: 0, body: { error: "network", detail: "The stream ended before the run finished." } };
}

export const resetWorkspace = () => workspaceFetch("/api/reset", { method: "POST", body: "{}" }).then((r) => r.ok);
