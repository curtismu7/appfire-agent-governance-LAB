// MCP Streamable HTTP, JSON answers only: initialize, notifications, ping, tools/list, tools/call (design B.3). No sockets here: server.js owns HTTP,
// this module turns one request into { status, headers, body } so it can be tested without a port.
import { randomUUID } from 'node:crypto';
import { TOOL_META } from './registry.js';
import { TOOL_NAMES, descriptorOf } from './tools.js';
import { BY, decide, listedFor } from './policy.js';
import { isObj, parseJson, traceIdOf } from './util.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const REALM = 'Bearer realm="appfire-tools-local"';
const SESSION_IDLE_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 200;
// Sessions with no token (the public tool only) live in their own small pool, so a flood of tokenless initialize calls can never evict a signed-in user's session.
const MAX_ANON_SESSIONS = 20;

const rpcError = (status, id, code, message) => ({ status, headers: {}, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
const rpcResult = (id, result, headers = {}) => ({ status: 200, headers, body: { jsonrpc: '2.0', id, result } });
const plain = (status, body, headers = {}) => ({ status, headers, body });
const validId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) || id === null;

// The refusal for a token that is missing or not accepted. The reason code is the only detail.
export function tokenRefusal(v) {
  if (v.reason === 'no_token') {
    return plain(401, { error: 'no_token', message: 'A bearer token is required for this call.', reason: 'no_token', by: BY }, { 'WWW-Authenticate': REALM });
  }
  if (v.status === 503) {
    return plain(503, { error: 'jwks_unavailable', message: "The tool server could not get the issuer's signing keys, so it made no decision.", reason: 'jwks_unavailable', by: BY }, { 'Retry-After': '5' });
  }
  return plain(401, { error: 'invalid_token', message: 'The token was not accepted.', reason: v.reason, by: BY }, { 'WWW-Authenticate': `${REALM}, error="invalid_token", error_description="${v.reason}"` });
}

export function createMcp({ config, verifier, hitl, now = Date.now, newSessionId = randomUUID }) {
  const sessions = new Map();     // id -> { sub, last }
  const descriptors = Object.fromEntries(TOOL_NAMES.map((n) => [n, descriptorOf(n)]));

  function prune() {
    for (const [id, s] of sessions) if (now() - s.last > SESSION_IDLE_MS) sessions.delete(id);
  }
  function open(sub) {
    prune();
    const anon = sub === 'anon';
    const drop = (keep) => { for (const [k, v] of sessions) if (keep(v)) { sessions.delete(k); return true; } return false; };   // the oldest that matches
    if (anon) { let n = 0; for (const v of sessions.values()) if (v.anon) n += 1; if (n >= MAX_ANON_SESSIONS) drop((v) => v.anon); }
    while (sessions.size >= MAX_SESSIONS) if (!drop((v) => v.anon)) sessions.delete(sessions.keys().next().value);   // anonymous ones first, then the oldest idle one
    const id = newSessionId();
    sessions.set(id, { sub, last: now(), anon });
    return id;
  }
  function touch(id, sub) {
    prune();
    const s = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!s || s.sub !== sub) return false;
    sessions.delete(id); s.last = now(); sessions.set(id, s);     // keeps the Map in least-recently-used order
    return true;
  }
  const unknownSession = () => plain(404, { error: 'session_unknown' });

  async function authenticate(authorization) {
    if (authorization === undefined) return { auth: null };
    const v = await verifier(authorization);
    return v.ok ? { auth: v } : { refusal: tokenRefusal(v) };
  }

  async function post({ authorization, sessionId, traceparent, bodyText }) {
    const parsed = parseJson(bodyText);
    if (!parsed.ok) return rpcError(400, null, -32700, 'parse error');
    const msg = parsed.value;
    if (Array.isArray(msg)) return rpcError(400, null, -32600, 'batch requests are not supported');
    if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || (Object.hasOwn(msg, 'id') && !validId(msg.id))) return rpcError(400, null, -32600, 'invalid request');
    const { method } = msg;
    const hasId = Object.hasOwn(msg, 'id');

    // A token that is presented is always checked, whatever the method.
    const who = await authenticate(authorization);
    if (who.refusal) return who.refusal;
    const { auth } = who;
    const sub = auth ? auth.claims.sub : 'anon';

    if (method.startsWith('notifications/')) return { status: 202, headers: {}, body: null };
    if (!hasId) return rpcError(400, null, -32600, 'invalid request');
    const id = msg.id;
    const params = Object.hasOwn(msg, 'params') ? msg.params : undefined;

    if (method === 'initialize') {
      const asked = isObj(params) && Object.hasOwn(params, 'protocolVersion') ? params.protocolVersion : null;
      return rpcResult(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'appfire-tools-local', title: 'Appfire Work Suite tool server (lab, local)', version: '1' },
      }, { 'Mcp-Session-Id': open(sub) });
    }
    if (method === 'ping') return rpcResult(id, {});

    if (method === 'tools/call' && !auth) {
      // With no token the server never says whether a name exists: only a public tool may be called without one.
      const name = isObj(params) && Object.hasOwn(params, 'name') ? params.name : null;
      if (!(typeof name === 'string' && Object.hasOwn(TOOL_META, name) && TOOL_META[name].public)) return tokenRefusal({ reason: 'no_token' });
    }
    if (!touch(sessionId, sub)) return unknownSession();

    if (method === 'tools/list') {
      return rpcResult(id, { tools: TOOL_NAMES.filter((n) => listedFor(n, auth, config.tierGroup)).map((n) => descriptors[n]) });
    }
    if (method === 'tools/call') {
      if (!isObj(params) || !Object.hasOwn(params, 'name') || typeof params.name !== 'string') return rpcError(200, id, -32602, 'invalid params');
      const name = params.name;
      const decision = decide({ name, rawArgs: Object.hasOwn(params, 'arguments') ? params.arguments : undefined, auth, config, hitl, now });
      if (decision.kind === 'rpc_error') return rpcError(200, id, decision.code, decision.message);
      const headers = {};
      if (decision.audit) {
        headers['X-Gw-Audit-Trail'] = JSON.stringify({ decision: decision.audit.decision, source: 'lab-policy', rule: decision.audit.rule, tool: name, trace: traceIdOf(traceparent) });
      }
      if (decision.kind === 'refuse') {
        if (decision.wwwAuthenticate) headers['WWW-Authenticate'] = decision.wwwAuthenticate;
        return plain(decision.status, decision.body, headers);
      }
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(decision.payload) }], structuredContent: decision.payload, isError: false }, headers);
    }
    return rpcError(200, id, -32601, 'method not found');
  }

  async function del({ authorization, sessionId }) {
    const who = await authenticate(authorization);
    if (who.refusal) return who.refusal;
    const sub = who.auth ? who.auth.claims.sub : 'anon';
    if (!touch(sessionId, sub)) return unknownSession();
    sessions.delete(sessionId);
    return { status: 204, headers: {}, body: null };
  }

  return { post, del, sessionCount: () => sessions.size };
}
