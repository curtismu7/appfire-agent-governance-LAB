// PingOne Authorize decides the airline booking (phase C, docs/design-authorize-lab.md B.3, B.4, B.6, C). PARENT SIDE ONLY: this module holds the worker client's secret and
// makes the one network call; the lab's own tool server (a child process with no network and no secret) asks it over IPC (localServices.js) with seven canonical
// parameters, and gets back a small enum. Node built-ins only; it reads no environment and writes no log: an error becomes a fixed reason word, never a message, a header or a body.
//
// The call: POST <decisionUrl> with a bearer token from a client_credentials grant (HTTP Basic, no scope), body { parameters }, answer JSON { decision, statements: [{ code, ... }] }.
// The endpoint evaluates the WHOLE shared policy tree, so the reader ignores every code that is not one of ours, and the CODE decides (a payload is display evidence only).
// NO DECISION is never a permit, never a refusal and never a fall back to the lab's own rule. UNVERIFIED against a tenant: the fakes prove the lab's reading only.

export const POLICY_NAME = 'Larkspur Air Booking Authorization';
export const PARAMS = ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval'];
// The audit header's `source` the tool server stamps on an answer Authorize gave, and the eight codes the lab knows (a copy of server/src/local/registry.js AUTHORIZE_CODES: a parity test pins equal).
export const AUTHORIZE_SOURCE = 'pingone-authorize';
export const CODES = Object.freeze({
  'airline-permit-as-asked': Object.freeze({ outcome: 'permit', decision: 'PERMIT', word: 'PERMIT', because: Object.freeze([]), note: 'permit' }),
  'airline-economy-intl': Object.freeze({ outcome: 'narrow', decision: 'PERMIT', word: 'CONSTRAINED', because: Object.freeze(['international']), note: 'narrow' }),
  'airline-economy-over-limit': Object.freeze({ outcome: 'narrow', decision: 'PERMIT', word: 'CONSTRAINED', because: Object.freeze(['over-limit']), note: 'narrow' }),
  'airline-economy-intl-over-limit': Object.freeze({ outcome: 'narrow', decision: 'PERMIT', word: 'CONSTRAINED', because: Object.freeze(['international', 'over-limit']), note: 'narrow' }),
  'airline-approval-required': Object.freeze({ outcome: 'approval', decision: 'PERMIT', word: 'HITL_REQUIRED', because: Object.freeze([]), note: 'approval-required' }),
  'airline-approved-as-asked': Object.freeze({ outcome: 'approved', decision: 'PERMIT', word: 'PERMIT', because: Object.freeze([]), note: 'approved' }),
  'airline-second-factor-required': Object.freeze({ outcome: 'second_factor', decision: 'PERMIT', word: 'STEP_UP', because: Object.freeze([]), note: 'second-factor-required' }),
  'airline-booking-refused': Object.freeze({ outcome: 'deny', decision: 'DENY', word: 'DENY', because: Object.freeze([]), note: 'refused' }),
});
const CATCH_ALL = 'airline-unmatched';
// The words the page uses after `PingOne Authorize gave no decision: ` (C.2). Fixed text: nothing from an answer is ever copied into them.
export const REASON_WORDS = Object.freeze({
  not_applicable: 'no policy applied to this request',
  indeterminate: 'it could not evaluate the request',
  no_airline_code: 'its answer held no airline booking decision',
  only_unmatched: 'its answer said no airline booking rule matched',
  ambiguous: 'its answer held two different booking decisions',
  unrecognised: 'its answer was not one this lab recognises',
  malformed: 'its answer could not be read',
  rate_limited: 'it is rate limiting this lab',
  refused_credential: "it refused the lab's worker credential",
  endpoint: 'its decision endpoint is not available',
  server_error: 'it answered with a server error',
  unreachable: 'it could not be reached',
  timeout: 'it did not reply in time',
  busy: 'the lab could not ask it',
  unavailable: 'the lab could not ask it',
});
export const OUTCOMES = Object.freeze(['permit', 'narrow', 'approval', 'approved', 'second_factor', 'deny', 'no_decision']);
export const MAX_RESPONSE_CHARS = 65536;
const MAX_TOKEN_RESPONSE = 16 * 1024;
const MAX_TOKEN_CHARS = 8192;
const TRACE = /^[0-9a-f]{32}$/;
const CORRELATION = /^[A-Za-z0-9-]{1,64}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const PATTERNS = {
  AirLabMarker: /^larkspur-air$/,
  ToolName: /^book_airline_flight$/,
  UserId: /^[^\u0000-\u001f\u007f]{1,200}$/,
  AirFare: /^(?!0+(\.0+)?$)\d{1,6}(\.\d{1,2})?$/,
  AirIsInternational: /^(true|false)$/,
  AirCabinAsked: /^(business|economy)$/,
  AirApproval: /^(none|verified)$/,
};

// Exactly the seven keys, every value a string matching its pattern. Returns { ok: true, params } (a fresh object in key order) or { ok: false }. Never throws.
export function normalizeParams(p) {
  if (!isObj(p)) return { ok: false };
  const keys = Object.keys(p);
  if (keys.length !== PARAMS.length || !PARAMS.every((k) => Object.hasOwn(p, k))) return { ok: false };
  const out = {};
  for (const k of PARAMS) {
    const v = p[k];
    if (typeof v !== 'string' || !PATTERNS[k].test(v)) return { ok: false };
    out[k] = v;
  }
  return { ok: true, params: out };
}

const noDecision = (reason, extra = {}) => ({ outcome: 'no_decision', code: null, reason, correlationId: null, elapsedMs: null, ...extra });

// The parent's answer to the child, or null when its shape is not the contract (used before anything is sent over IPC).
export function shapeResult(r) {
  if (!isObj(r) || !OUTCOMES.includes(r.outcome)) return null;
  const elapsedMs = Number.isInteger(r.elapsedMs) && r.elapsedMs >= 0 && r.elapsedMs <= 600000 ? r.elapsedMs : null;
  const correlationId = typeof r.correlationId === 'string' && CORRELATION.test(r.correlationId) ? r.correlationId : null;
  if (r.outcome === 'no_decision') return Object.hasOwn(REASON_WORDS, r.reason) ? { outcome: 'no_decision', code: null, reason: r.reason, correlationId, elapsedMs } : null;
  if (typeof r.code !== 'string' || !Object.hasOwn(CODES, r.code) || CODES[r.code].outcome !== r.outcome) return null;
  return { outcome: r.outcome, code: r.code, reason: null, correlationId, elapsedMs };
}

const mediaOk = (contentType) => {
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return t === 'application/json' || (/^application\/[a-z0-9.!#$&^_-]+\+json$/.test(t));
};

// The reason for an HTTP status other than 200 (B.4 item 5; 401 and 429 reach here only after their one retry).
export function reasonForStatus(status) {
  if (status === 401 || status === 403) return 'refused_credential';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'endpoint';
}

// The ONE reading of an answer (C.3), pure. `sent`: the parameters the lab sent (the consistency rules read them). Returns the IPC result shape:
// { outcome, code, reason, correlationId, elapsedMs: null } where outcome 'no_decision' carries a reason from REASON_WORDS and every other outcome carries one of our eight codes.
export function readDecision({ status, contentType, text, sent }) {
  if (status !== 200) return noDecision(reasonForStatus(status));
  if (!mediaOk(contentType)) return noDecision('malformed');
  if (typeof text !== 'string' || text.length > MAX_RESPONSE_CHARS) return noDecision('malformed');
  let doc;
  try { doc = JSON.parse(text); } catch { return noDecision('malformed'); }
  if (!isObj(doc)) return noDecision('malformed');
  if (!['PERMIT', 'DENY', 'NOT_APPLICABLE', 'INDETERMINATE'].includes(doc.decision)) return noDecision('malformed');
  if (doc.decision === 'NOT_APPLICABLE') return noDecision('not_applicable');
  if (doc.decision === 'INDETERMINATE') return noDecision('indeterminate');
  const list = doc.statements === undefined || doc.statements === null ? [] : doc.statements;
  if (!Array.isArray(list)) return noDecision('malformed');
  // Only statements with a string code can be ours; anything else (the shared tree's other statements) is ignored, never a reason to refuse the answer.
  const coded = list.filter((s) => isObj(s) && typeof s.code === 'string');
  if (isObj(doc.status) && typeof doc.status.code === 'string' && doc.status.code !== 'OKAY') return noDecision('indeterminate');
  const ours = [...new Set(coded.map((s) => s.code).filter((c) => c.startsWith('airline-')))];
  const sawCatchAll = ours.includes(CATCH_ALL);
  const specific = ours.filter((c) => c !== CATCH_ALL);
  if (specific.some((c) => !Object.hasOwn(CODES, c))) return noDecision('unrecognised');
  if (specific.length === 0) return noDecision(sawCatchAll ? 'only_unmatched' : 'no_airline_code');
  if (specific.length > 1) return noDecision('ambiguous');
  const code = specific[0];
  const row = CODES[code];
  if (doc.decision !== row.decision) return noDecision('unrecognised');
  // The consistency rules against what the lab SENT. No rule compares a code with the fare number or the limit: the owner may edit the limit in the console.
  const s = isObj(sent) ? sent : {};
  if (row.outcome === 'narrow' && s.AirCabinAsked !== 'business') return noDecision('unrecognised');
  if (row.outcome === 'approval' && s.AirApproval !== 'none') return noDecision('unrecognised');
  if (row.outcome === 'approved' && s.AirApproval !== 'verified') return noDecision('unrecognised');
  // Payload cross-check, display evidence only: only `cabin` (narrowing codes) and `outcome` are read, and only to catch a contradiction.
  for (const st of coded.filter((x) => x.code === code)) {
    let payload = st.payload;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    if (!isObj(payload)) continue;
    if (row.outcome === 'narrow' && Object.hasOwn(payload, 'cabin') && typeof payload.cabin === 'string' && payload.cabin !== 'economy') return noDecision('unrecognised');
    const word = Object.hasOwn(payload, 'outcome') && typeof payload.outcome === 'string' ? payload.outcome : null;
    if (word !== null && PAYLOAD_WORDS.includes(word) && word !== row.note) return noDecision('unrecognised');
  }
  const correlationId = typeof doc.correlationId === 'string' && CORRELATION.test(doc.correlationId) ? doc.correlationId : null;
  return { outcome: row.outcome, code, reason: null, correlationId, elapsedMs: null };
}
const PAYLOAD_WORDS = ['permit', 'narrow', 'approval-required', 'approved', 'second-factor-required', 'refused'];

// What the tool server's audit header says, read by the lab (real.js): { code, outcome, word, correlationId, elapsedMs } only when the header is a PingOne Authorize answer
// with one of our eight codes whose decision word is the one that code carries; otherwise null (never credited). The caller still checks that the provider is the local one
// and that the lab's own Authorize settings are on.
export function trustedAnswer(parsed) {
  if (!isObj(parsed) || parsed.source !== AUTHORIZE_SOURCE || typeof parsed.rule !== 'string' || !Object.hasOwn(CODES, parsed.rule)) return null;
  const row = CODES[parsed.rule];
  if (parsed.decision !== row.word) return null;
  return {
    code: parsed.rule, outcome: row.outcome, word: row.word,
    correlationId: typeof parsed.correlation === 'string' && CORRELATION.test(parsed.correlation) ? parsed.correlation : null,
    elapsedMs: Number.isInteger(parsed.elapsed_ms) && parsed.elapsed_ms >= 0 && parsed.elapsed_ms <= 600000 ? parsed.elapsed_ms : null,
  };
}

const LIMITS = Object.freeze({ headersMs: 5000, bodyMs: 10000, totalMs: 20000, paceMs: 1100, retry429Ms: 1500, maxQueued: 4 });
const delay = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });
const urlOk = (u) => {
  try {
    const x = new URL(u);
    if (x.username || x.password || x.hash) return false;
    return x.protocol === 'https:' || (x.protocol === 'http:' && /^(127(\.\d{1,3}){3}|localhost|\[::1\])$/.test(x.hostname));
  } catch { return false; }
};

// config: { tokenUrl, decisionUrl, clientId, clientSecret } from real.js (parent only), or null. The child cannot choose, change or see either URL.
// limits (tests only) overrides the timers; fetchImpl, now and sleep are injected.
export function createAuthorize({ config, fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now, sleep = delay, limits = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const ok = Boolean(config) && urlOk(config.tokenUrl) && urlOk(config.decisionUrl) && typeof config.clientId === 'string' && config.clientId !== '' && typeof config.clientSecret === 'string' && config.clientSecret !== '';
  const fixed = ok ? Object.freeze({ tokenUrl: String(config.tokenUrl), decisionUrl: String(config.decisionUrl) }) : null;
  const basic = ok ? `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}` : null;
  let token = null;            // { value, until }
  let tokenFlight = null;
  let chain = Promise.resolve();
  let waiting = 0;             // queued or running
  let lastStart = -Infinity;
  const ring = new Map();      // trace id -> evidence entry (at most 50)

  const keep = (trace, entry) => {
    if (typeof trace !== 'string' || !TRACE.test(trace)) return;
    ring.delete(trace); ring.set(trace, entry);
    while (ring.size > 50) ring.delete(ring.keys().next().value);
  };

  // The raw answer goes on the page (step detail). An endpoint that echoes our credentials must not put them there: the worker secret, its Basic form and the bearer are replaced.
  // (Defence in depth: PingOne does not echo them.) Applied to the text BEFORE it is parsed for display; the decision itself is read from the unscrubbed text.
  function scrubShown(text, bearer) {
    let t = String(text);
    for (const secretText of [config.clientSecret, basic?.slice(6), basic, typeof bearer === 'string' && bearer.length >= 8 ? bearer : null]) {
      if (typeof secretText === 'string' && secretText.length >= 6) t = t.split(secretText).join('(removed)');
    }
    return t;
  }

  // One HTTP exchange with the two timers (headers, then body) and a body cap. Resolves { status, contentType, text, truncated } or { fail: <reason word> }. Never throws.
  async function exchange(url, init, { headersMs, bodyMs, maxChars }) {
    if (url !== fixed.tokenUrl && url !== fixed.decisionUrl) return { fail: 'unavailable' };      // the URL is the parent's, re-asserted before every request
    const ac = new AbortController();
    let timedOut = false;
    const arm = (ms) => { const t = setTimeout(() => { timedOut = true; ac.abort(); }, Math.max(1, ms)); t.unref?.(); return t; };
    let timer = arm(headersMs);
    try {
      const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: ac.signal });
      clearTimeout(timer); timer = arm(bodyMs);
      const status = res.status;
      const contentType = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
      let text = ''; let truncated = false;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          text += dec.decode(value, { stream: true });
          if (bytes > maxChars * 4 || text.length > maxChars) { truncated = true; try { await reader.cancel(); } catch { /* gone */ } break; }
        }
        if (!truncated) text += dec.decode();
      } else if (typeof res.text === 'function') { text = await res.text(); truncated = text.length > maxChars; }
      clearTimeout(timer);
      return { status, contentType, text: truncated ? text.slice(0, maxChars + 1) : text, truncated };
    } catch {
      clearTimeout(timer);
      return { fail: timedOut ? 'timeout' : 'unreachable' };
    }
  }

  // The worker token, cached until expires_in - 60 s (never less than 30 s, never beyond expires_in - 5 s; 300 s when expires_in is absent). Single-flight. Never logged or returned.
  async function getToken(remaining) {
    if (token && now() < token.until) return { ok: true, value: token.value };
    if (!tokenFlight) {
      tokenFlight = (async () => {
        const r = await exchange(fixed.tokenUrl, {
          method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'grant_type=client_credentials',
        }, { headersMs: Math.min(L.headersMs, remaining()), bodyMs: L.bodyMs, maxChars: MAX_TOKEN_RESPONSE });
        if (r.fail) return { ok: false, reason: r.fail };
        if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, reason: 'refused_credential' };
        if (r.status >= 500) return { ok: false, reason: 'server_error' };
        if (r.status !== 200) return { ok: false, reason: 'endpoint' };
        if (r.truncated) return { ok: false, reason: 'malformed' };
        let j; try { j = JSON.parse(r.text); } catch { return { ok: false, reason: 'malformed' }; }
        if (!isObj(j) || typeof j.access_token !== 'string' || j.access_token.length < 1 || j.access_token.length > MAX_TOKEN_CHARS) return { ok: false, reason: 'malformed' };
        const life = Number.isFinite(j.expires_in) && j.expires_in > 0 ? j.expires_in : 305;
        const keepFor = Math.min(Math.max(life - 60, 30), Math.max(life - 5, 1));
        token = { value: j.access_token, until: now() + keepFor * 1000 };
        return { ok: true, value: j.access_token };
      })().finally(() => { tokenFlight = null; });
    }
    return tokenFlight;
  }

  async function job(params, trace, arrival) {
    const deadline = arrival + L.totalMs;
    const remaining = () => deadline - now();
    const wait = lastStart + L.paceMs - now();
    if (wait > 0) { if (wait >= remaining()) return noDecision('timeout'); await sleep(wait); }
    if (remaining() <= 0) return noDecision('timeout');
    lastStart = now();
    let tk = await getToken(remaining);
    if (!tk.ok) return noDecision(tk.reason);
    const entry = { trace: typeof trace === 'string' && TRACE.test(trace) ? trace : null, request: null, response: null, posts: 0, tokenRefreshed: false };
    let refreshed = false; let retried429 = false;
    for (;;) {
      if (remaining() <= 0) return finish(noDecision('timeout'));
      const body = JSON.stringify({ parameters: params });
      const started = now();
      entry.posts += 1;
      entry.request = {
        method: 'POST', url: fixed.decisionUrl,
        headers: { authorization: 'Bearer (worker token, not shown)', 'content-type': 'application/json', accept: 'application/json, application/hal+json' },
        body: { parameters: { ...params } },
      };
      const r = await exchange(fixed.decisionUrl, {
        method: 'POST', headers: { authorization: `Bearer ${tk.value}`, 'content-type': 'application/json', accept: 'application/json, application/hal+json' }, body,
      }, { headersMs: Math.min(L.headersMs, remaining()), bodyMs: Math.min(L.bodyMs, Math.max(1, remaining())), maxChars: MAX_RESPONSE_CHARS });
      const elapsedMs = Math.min(600000, Math.max(0, Math.round(now() - started)));
      if (r.fail) { entry.response = null; return finish(noDecision(r.fail)); }
      entry.response = { status: r.status, contentType: r.contentType ?? null, body: shownBody(scrubShown(r.text, tk.value), r.truncated), elapsedMs };
      if (r.status === 401) {
        if (refreshed) return finish(noDecision('refused_credential'));
        refreshed = true; entry.tokenRefreshed = true; token = null;
        tk = await getToken(remaining);
        if (!tk.ok) return finish(noDecision(tk.reason));
        continue;
      }
      if (r.status === 429) {
        if (retried429) return finish(noDecision('rate_limited'));
        retried429 = true;
        if (L.retry429Ms >= remaining()) return finish(noDecision('timeout'));
        await sleep(L.retry429Ms);
        continue;
      }
      if (r.status !== 200) return finish(noDecision(reasonForStatus(r.status)));
      if (r.truncated) return finish(noDecision('malformed'));
      const read = readDecision({ status: 200, contentType: r.contentType, text: r.text, sent: params });
      return finish({ ...read, elapsedMs });
    }
    function finish(result) { if (result?.code) entry.answer = { code: result.code }; if (entry.trace && entry.request) keep(entry.trace, entry); return result; }
  }

  // decide(params, { trace }) -> { outcome, code, reason, correlationId, elapsedMs }. Never rejects. Calls run ONE AT A TIME, in arrival order, at least paceMs apart
  // (a "use latest" endpoint is rate limited); at most four wait or run, a fifth is busy.
  function decide(params, { trace = null } = {}) {
    if (!ok) return Promise.resolve(noDecision('unavailable'));
    const norm = normalizeParams(params);
    if (!norm.ok) return Promise.resolve(noDecision('malformed'));
    if (waiting >= L.maxQueued) return Promise.resolve(noDecision('busy'));
    waiting += 1;
    const arrival = now();
    const run = chain.then(() => job(norm.params, trace, arrival)).catch(() => noDecision('unavailable'));
    chain = run.then(() => undefined, () => undefined);
    return run.finally(() => { waiting -= 1; });
  }

  // The raw request and answer of the last decision call for this trace id (the step detail shows them); forgotten once read.
  function evidenceFor(trace) {
    if (typeof trace !== 'string' || !ring.has(trace)) return null;
    const e = ring.get(trace);
    ring.delete(trace);
    return e;
  }

  return { configured: ok, decide, evidenceFor };
}

// The raw answer for the step detail: the parsed JSON when the text is short, else the first part of it; text that is not JSON is cut hard. Untrusted: the page renders it as text.
function shownBody(text, truncated) {
  if (truncated) return { truncated: true, text: String(text).slice(0, 4000) };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { text: String(text).slice(0, 400) }; }
  if (text.length <= 4096) return parsed;
  return { truncated: true, text: text.slice(0, 4000) };
}
