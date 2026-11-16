// "What Privilege did" for this lab (rule 25): turns one gateway call into the record GatewayTrace.jsx draws, using the shared builder
// server/src/gatewayTrace.js (vendored byte for byte, never edited; trace.js is the W3C traceparent helper and is not touched).
//
// This lab has TWO gateways, and the honesty rule is different for each:
//   MOCK (flow.js): the lab's own simulated gateway computed the checks (gatewayCheck: signature, aud, act, DPoP, rate, scope, edge policy), so
//   those decisions are `checked`, in the order the code evaluated them; a check after the first refusal was never run and is not listed.
//   The other simulated gateway hops (the no-token challenge, tools/list, the Privilege leg) compute nothing, so they say `observed` (read from
//   what the simulation answered) and never `checked`.
//   REAL (real.js gatewayLeg through mcpClient.js): the lab's own MCP client called the SE Agent Gateway. A real gateway reports no per-check
//   detail, so every decision is `inferred` (read from the status) or `observed` (read from the response, such as the X-Gw-Audit-Trail header).
//
// What a trace never holds: the delegated token (only its length is shown), the full MCP session id (shortened), the HITL challenge id and the
// receipt the lab echoes back after an approval, and anything the lab keeps write-only. The lab's Tokens tab still shows real tokens raw (owner 2026-11-14); the
// trace follows rule 25 instead, so a copy of the trace is safe to paste.
import { bearerForDisplay, failureTrace, mockTrace, realTrace } from './gatewayTrace.js';
import { parseAuditTrail } from './mcpClient.js';

// A simulated gateway's host is never a real one: the engine's `.example` hosts become `.invalid`.
export const mockGatewayUrl = (url) => String(url).replace(/\.example(?=[/:]|$)/, '.invalid');

const NO_AUTH = '(none: the request carries no Authorization header)';
const shortSession = (v) => (String(v).length > 8 ? `${String(v).slice(0, 8)}… (shortened)` : String(v));

// The request headers the lab really sent beyond the shared builder's defaults, as its `requestHeaders` option (an empty value is not a header).
const sent = (extra) => Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null));

// ---- Mock -----------------------------------------------------------------------------------------------------------------------------
// hop: the engine's own hop object (its request and response are what the page already shows); decisions: what the simulation computed or observed.
export function mockExchange(hop, { title, decisions, record = null }) {
  const req = hop.request || {};
  const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : null;
  const { authorization: _auth, 'content-type': _type, ...rest } = req.headers || {};
  const trace = mockTrace({
    url: mockGatewayUrl(req.url),
    authorization: auth ? bearerForDisplay(auth) : NO_AUTH,
    rpc: req.body ?? null,
    status: hop.response.status,
    body: hop.response.body ?? null,
    headers: { 'content-type': 'application/json', ...(hop.response.headers || {}) },
    requestHeaders: sent(rest),
    decisions,
    record,
  });
  return { step: hop.n, title, status: hop.response.status, trace };
}

// ---- Real -----------------------------------------------------------------------------------------------------------------------------
function scrubDeep(value, secrets) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  const walk = (v) => {
    if (typeof v === 'string') return list.reduce((t, s) => t.split(s).join('<kept on the server>'), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

// The gateway's X-Gw-Audit-Trail header, read for the one thing it states: its decision. Observed, not inferred: the gateway wrote it.
function auditDecision(headers) {
  const audit = parseAuditTrail(headers?.['x-gw-audit-trail']);
  if (!audit?.decision) return null;
  const word = audit.decision.toUpperCase();
  const outcome = /^(PERMIT|ALLOW)/.test(word) ? 'pass' : /^(DENY|DENIED|REFUSE)/.test(word) ? 'fail' : 'info';
  return { id: 'audit', label: 'Authorize decision', outcome, basis: 'observed', evidence: `the gateway's X-Gw-Audit-Trail header states the decision ${audit.decision}` };
}

const HOLD_TEXT = 'HTTP 428: the gateway held the call for a person to approve it (or for a stronger authentication). A hold is not a pass and not a refusal.';

// c: what mcpClient.js send() returned for one call. token: the delegated bearer (never shown). setup: the session calls around it.
export function realExchange(c, { step, title, url, token, vertical, setup, receipt = null }) {
  const authorization = bearerForDisplay('<delegated token>', () => `Bearer ${token}`);
  // The hold's challenge id is what the mock phone later turns into the receipt: the lab keeps it server-side (it travels only as run.challenge).
  const secrets = [token, c.sessionId, receipt, c.rpc?.challengeId, c.rpc?.error?.challengeId];
  const body = c.sentBody ?? null;
  // The receipt the lab echoes back after an approval is a credential that discharges the hold: it is never shown.
  const rpc = receipt && body?.params?.arguments?._hitl_challenge_id ? { ...body, params: { ...body.params, arguments: { ...body.params.arguments, _hitl_challenge_id: '<approval receipt, kept on the server>' } } } : body;
  const headers = { ...(c.headers || {}) };
  if (headers['mcp-session-id']) headers['mcp-session-id'] = shortSession(headers['mcp-session-id']);
  const extra = {
    traceparent: c.traceparent,
    'x-active-vertical': vertical,
    'x-token-validation': 'jwks',
    ...(c.sessionId ? { 'mcp-session-id': shortSession(c.sessionId) } : {}),
    ...(c.protocol ? { 'mcp-protocol-version': c.protocol } : {}),
  };
  let trace;
  if (c.status === 0) {
    trace = failureTrace({ url, authorization, rpc, requestHeaders: sent(extra), error: 'no answer: the connection failed or timed out, so there is no response and nothing to decide from' });
  } else {
    const detail = c.status === 428 ? HOLD_TEXT : c.kind === 'other' && c.status >= 300 && c.status < 400 ? `HTTP ${c.status}: a redirect, which the lab never follows` : undefined;
    trace = realTrace({ url, authorization, rpc, requestHeaders: sent(extra), status: c.status, headers, body: c.rpc ?? (c.rawText || null), detail, at: c.at, setup });
    const audit = auditDecision(c.headers);
    if (audit) trace.decisions.push(audit);
  }
  return { step, title, status: c.status || null, trace: scrubDeep(trace, secrets) };
}
