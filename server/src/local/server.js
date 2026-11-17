// The local tool server and approval service: one node:http server on 127.0.0.1 (design B.2). Loopback only, no CORS, no browser.
import http from 'node:http';
import { createHitl, argsDigest } from './hitl.js';
import { createKeySource } from './jwks.js';
import { createVerifier } from './verify.js';
import { createMcp } from './mcp.js';
import { DEFAULT_AIRLINE_TIER_GROUP } from './registry.js';
import { TOOL_NAMES } from './tools.js';
import { constantTimeEqual, isLoopbackHost, isObj, isPlainDnsName, parseJson, readBody } from './util.js';

const MAX_BODY = 65536;
const MAX_IN_FLIGHT = 32;
const SECRET_HEADER = 'x-hitl-internal-secret';

// Checks the init message the parent sends. Returns { ok: true, config } or { ok: false } (never a value in the failure).
export function validateInit(c) {
  if (!isObj(c)) return { ok: false };
  const str = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
  let u;
  try { u = new URL(c.issuer); } catch { return { ok: false }; }
  const loopback = isLoopbackHost(u.hostname);
  if (typeof c.issuer !== 'string' || !(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) return { ok: false };
  if (u.username || u.password || u.search || u.hash || u.pathname === '/' || c.issuer.endsWith('/') || c.issuer.includes('?') || c.issuer.includes('#')) return { ok: false };
  if (!loopback && !isPlainDnsName(u.hostname)) return { ok: false };      // the guard can allow names only
  if (!str(c.audience, 1, 300)) return { ok: false };
  if (!Array.isArray(c.allowedActors) || c.allowedActors.length < 1 || c.allowedActors.length > 5 || !c.allowedActors.every((a) => str(a, 1, 200))) return { ok: false };
  if (!str(c.tierGroup, 1, 120)) return { ok: false };
  if (c.tierGroupAirline !== undefined && !str(c.tierGroupAirline, 1, 120)) return { ok: false };
  if (typeof c.hitlSecret !== 'string' || !/^[0-9a-f]{64}$/.test(c.hitlSecret)) return { ok: false };
  const skew = c.clockSkewSeconds === undefined ? 60 : c.clockSkewSeconds;
  if (!Number.isInteger(skew) || skew < 0 || skew > 300) return { ok: false };
  return {
    ok: true,
    config: { issuer: c.issuer, audience: c.audience, allowedActors: [...c.allowedActors], tierGroup: c.tierGroup, tierGroupAirline: c.tierGroupAirline ?? DEFAULT_AIRLINE_TIER_GROUP, hitlSecret: c.hitlSecret, clockSkewSeconds: skew },
    issuerHost: loopback ? null : u.hostname.toLowerCase(),
  };
}

const json = (res, status, body, headers = {}) => {
  const text = body === null || body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...(text ? { 'content-type': 'application/json; charset=utf-8' } : {}), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(text);
};
const isJsonType = (req) => String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'application/json';

// options: { config, now, fetchImpl, port, jwks: { ... key source timing }, bodyDeadlineMs (a request body that has not arrived by then is dropped) }
export function startLocalServer({ config, now = Date.now, fetchImpl, port = 0, jwks = {}, bodyDeadlineMs = 10_000 }) {
  const keySource = createKeySource({ issuer: config.issuer, now, ...(fetchImpl ? { fetchImpl } : {}), ...jwks });
  const verifier = createVerifier({ issuer: config.issuer, audience: config.audience, allowedActors: config.allowedActors, skewSeconds: config.clockSkewSeconds ?? 60, keySource, now });
  const hitl = createHitl({ now });
  const mcp = createMcp({ config, verifier, hitl, now });
  let inFlight = 0;

  const authHeaderOf = (req) => {
    // Node keeps only the first of a repeated Authorization header; the raw list shows the repeat.
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'authorization') count += 1;
    if (count > 1) return ['repeated'];
    return req.headers.authorization;
  };

  async function hitlRoute(req, res, path) {
    if (!constantTimeEqual(String(req.headers[SECRET_HEADER] ?? ''), config.hitlSecret)) { json(res, 401, { error: 'unauthorized' }); return; }
    const m = /^\/hitl\/challenges(?:\/([^/]{1,128})(\/respond|\/verify)?)?$/.exec(path);
    if (!m) { json(res, 404, { error: 'not_found' }); return; }
    const [, id, action] = m;
    const wantsGet = Boolean(id) && !action;
    if (req.method !== (wantsGet ? 'GET' : 'POST')) { json(res, 405, { error: 'method_not_allowed' }, { allow: wantsGet ? 'GET' : 'POST' }); return; }
    if (wantsGet) {
      const r = hitl.get(id);
      if (!r.ok) json(res, 404, { error: r.code }); else json(res, 200, { id: r.id, status: r.status, tool: r.tool, amount: r.amount, createdAt: r.createdAt, expiresAt: r.expiresAt });
      return;
    }
    if (!isJsonType(req)) { json(res, 415, { error: 'unsupported_media_type' }); return; }
    const read = await readBody(req, MAX_BODY, { deadlineMs: bodyDeadlineMs });
    if (!read.ok) { json(res, read.tooLarge ? 413 : 400, { error: read.tooLarge ? 'too_large' : 'bad_request' }, { connection: 'close' }); return; }
    const parsed = parseJson(read.text);
    const b = parsed.ok && isObj(parsed.value) ? parsed.value : null;
    if (!b) { json(res, 400, { error: 'bad_request' }); return; }
    const s = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max;
    if (!id) {
      if (!(s(b.sub, 200) && s(b.tool, 64) && typeof b.argsDigest === 'string' && /^[0-9a-f]{64}$/.test(b.argsDigest) && (b.amount === null || b.amount === undefined || (typeof b.amount === 'number' && Number.isFinite(b.amount))))) { json(res, 400, { error: 'bad_request' }); return; }
      const r = hitl.create({ sub: b.sub, tool: b.tool, argsDigest: b.argsDigest, amount: b.amount ?? null });
      if (!r.ok) json(res, 503, { error: 'capacity' }); else json(res, 201, { id: r.id, status: r.status, expiresAt: r.expiresAt, ttlSeconds: r.ttlSeconds });
      return;
    }
    if (action === '/respond') {
      if (!((b.decision === 'approved' || b.decision === 'denied') && s(b.respondedBy, 80))) { json(res, 400, { error: 'bad_request' }); return; }
      const r = hitl.respond(id, { decision: b.decision, respondedBy: b.respondedBy });
      if (r.ok) json(res, 200, { id: r.id, status: r.status, decision: r.decision, respondedAt: r.respondedAt });
      else if (r.code === 'already_answered') json(res, 409, { error: 'already_answered', status: r.status });
      else json(res, r.code === 'expired' ? 410 : 404, { error: r.code });
      return;
    }
    if (!(s(b.sub, 200) && s(b.tool, 64) && typeof b.argsDigest === 'string' && /^[0-9a-f]{64}$/.test(b.argsDigest))) { json(res, 400, { error: 'bad_request' }); return; }
    const v = hitl.verify(id, { sub: b.sub, tool: b.tool, argsDigest: b.argsDigest });
    json(res, 200, v.valid ? { valid: true, id: v.id, consumed: true } : { valid: false, reason: v.reason });
  }

  async function handle(req, res) {
    const port = server.address()?.port;
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') { json(res, 403, { error: 'remote_refused' }); return; }
    if (!(req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`)) { json(res, 403, { error: 'host_refused' }); return; }
    if (req.headers.origin !== undefined) { json(res, 403, { error: 'origin_refused' }); return; }
    if (inFlight >= MAX_IN_FLIGHT) { json(res, 503, { error: 'busy' }); return; }
    inFlight += 1;
    let counted = true;
    res.on('close', () => { if (counted) { counted = false; inFlight -= 1; } });
    const path = (req.url ?? '').split('?')[0];

    if (path === '/health') {
      if (req.method !== 'GET') { json(res, 405, { error: 'method_not_allowed' }, { allow: 'GET' }); return; }
      json(res, 200, { ok: true, service: 'appfire-tools-local', version: 1, issuer: config.issuer, jwks: keySource.status(), tools: TOOL_NAMES.length });
      return;
    }
    if (path === '/mcp') {
      if (req.method === 'DELETE') {
        const r = await mcp.del({ authorization: authHeaderOf(req), sessionId: req.headers['mcp-session-id'] });
        json(res, r.status, r.body, r.headers);
        return;
      }
      if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' }); return; }
      if (!isJsonType(req)) { json(res, 415, { error: 'unsupported_media_type' }); return; }
      const read = await readBody(req, MAX_BODY, { deadlineMs: bodyDeadlineMs });
      if (!read.ok) { json(res, read.tooLarge ? 413 : 400, { error: read.tooLarge ? 'too_large' : 'bad_request' }, { connection: 'close' }); return; }
      const r = await mcp.post({ authorization: authHeaderOf(req), sessionId: req.headers['mcp-session-id'], traceparent: req.headers.traceparent, bodyText: read.text });
      json(res, r.status, r.body, r.headers);
      return;
    }
    if (path === '/hitl' || path.startsWith('/hitl/')) { await hitlRoute(req, res, path); return; }
    json(res, 404, { error: 'not_found' });
  }

  const server = http.createServer({ maxHeaderSize: 16384, connectionsCheckingInterval: 2000 }, (req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: 'internal_error' }); else res.end(); });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('listen_failed')));
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string' || addr.address !== '127.0.0.1') { server.close(); reject(new Error('listen_failed')); return; }
      resolve({
        server, port: addr.port, hitl, keySource, toolNames: [...TOOL_NAMES], argsDigest, inFlight: () => inFlight,
        close: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections(); }),
      });
    });
  });
}
