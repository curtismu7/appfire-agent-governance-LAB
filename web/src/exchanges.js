// A gateway step carries `request.calls` and `response.calls`: one entry per HTTP exchange with the gateway (initialize, tools/list, tools/call...). This
// turns the two lists into one summary per exchange, so a screen can show a line per call (what was asked, what came back, the status) and open the
// detail only when asked. Pure: it reads the hop and decides nothing. A shape it does not know is shown as "no body", never as a thrown error.
import { claimsOf } from "./components/HttpMessage";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const BEARER = /^Bearer\s+(\S+)$/i;
const scalar = (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const clip = (s, n = 140) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// Pairs the two lists. Both must be non-empty arrays; the lists have the same length when the gateway answered every call.
export function pairedCalls(hop) {
  const req = hop?.request?.calls, res = hop?.response?.calls;
  return Array.isArray(req) && Array.isArray(res) && req.length > 0 ? { request: req, response: res } : null;
}

// One line saying what came back, and up to a handful of facts (names, fields) to show as chips. Understands the shapes the Real path records.
export function resultOf(body) {
  if (body === null || body === undefined) return { text: "no body", items: [] };
  if (!isObj(body)) return { text: clip(scalar(body) ? body : "a list"), items: [] };
  if (isObj(body.error)) return { text: `error${body.error.code != null ? ` ${body.error.code}` : ""}: ${clip(body.error.message ?? "no message", 100)}`, items: [] };
  if (isObj(body.serverInfo)) {
    const si = body.serverInfo;
    return { text: [str(si.name), str(si.version)].filter(Boolean).join(" ") + (str(body.protocolVersion) ? ` · protocol ${body.protocolVersion}` : ""), items: [] };
  }
  if (typeof body.tools === "number") return { text: `${body.tools} tools offered`, items: Array.isArray(body.names) ? body.names.filter((n) => typeof n === "string").slice(0, 8) : [] };
  if ("content" in body) {
    const c = body.content;
    const head = body.isError === true ? "the tool returned an error" : null;
    if (Array.isArray(c)) return { text: head || `${c.length} ${c.length === 1 ? "item" : "items"}`, items: [] };
    if (isObj(c)) {
      const fields = Object.entries(c).filter(([, v]) => scalar(v)).slice(0, 4).map(([k, v]) => `${k} = ${clip(v, 40)}`);
      const lists = Object.entries(c).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${v.length} ${k}`);
      return { text: head || (lists.length ? lists.join(", ") : fields.join(", ")) || "a result", items: lists.length ? fields : [] };
    }
    return { text: head || clip(c ?? "no content"), items: [] };
  }
  return { text: "a result", items: Object.entries(body).filter(([, v]) => scalar(v)).slice(0, 4).map(([k, v]) => `${k} = ${clip(v, 40)}`) };
}

// What a token says in one phrase: who it names, who acts, how long it lives.
export function tokenSummary(claims) {
  if (!claims) return "token";
  const life = typeof claims.exp === "number" && typeof claims.iat === "number" ? `${Math.max(1, Math.round((claims.exp - claims.iat) / 60))} min` : null;
  const act = isObj(claims.act) ? str(claims.act.sub) : null;
  return ["JWT", str(claims.sub) ? `${claims.sub}${act ? ` via ${act}` : ""}` : null, life].filter(Boolean).join(" · ");
}

const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return str(url) || ""; } };

// The exchanges of a hop. Headers other than authorization are split into the ones that differ from the previous call and the ones that do not, so a
// repeated header is stated once ("same as call 3") instead of on every call.
export function exchangesOf({ request, response }) {
  const out = [];
  request.forEach((req, i) => {
    const r = isObj(req) ? req : {};
    const res = isObj(response[i]) ? response[i] : null;
    const body = isObj(r.body) ? r.body : {};
    const headers = isObj(r.headers) ? r.headers : {};
    const bearer = typeof headers.authorization === "string" ? BEARER.exec(headers.authorization) : null;
    const rest = Object.entries(headers).filter(([k]) => k !== "authorization").map(([k, v]) => [k, scalar(v) ? String(v) : JSON.stringify(v)]);
    const prev = out[i - 1] ? Object.fromEntries(out[i - 1].allHeaders) : null;
    const changed = prev ? rest.filter(([k, v]) => prev[k] !== v) : rest;
    const same = prev ? rest.filter(([k, v]) => prev[k] === v) : [];
    const args = isObj(body.arguments) && Object.keys(body.arguments).length ? body.arguments : null;
    const rpc = str(body.method);
    const tool = str(body.name);
    const result = resultOf(res ? res.body : undefined);
    const token = bearer ? { raw: bearer[1], claims: claimsOf(bearer[1]) } : null;
    out.push({
      n: i + 1, method: str(r.method) || "POST", url: str(r.url) || "", path: pathOf(r.url), rpc: rpc || "request", tool, args,
      status: res && Number.isFinite(res.status) ? res.status : null, result: result.text, items: result.items,
      token, sameTokenAs: token && out[i - 1]?.token?.raw === token.raw ? i : null,
      changedHeaders: changed, sameHeaders: same, sameHeadersAs: prev ? i : null, allHeaders: rest,
      raw: { request: req ?? null, response: response[i] ?? null },
    });
  });
  return out;
}

// The calls that open on their own: any that did not answer 2xx, else the last one (the one the step is about).
export const openByDefault = (ex) => {
  const bad = ex.filter((e) => e.status === null || e.status >= 400).map((e) => e.n);
  return new Set(bad.length ? bad : ex.length ? [ex[ex.length - 1].n] : []);
};
