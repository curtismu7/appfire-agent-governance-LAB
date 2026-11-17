// Test support for the local tool server: a fake issuer + the real server on a loopback port + small HTTP and MCP helpers.
import http from 'node:http';
import { startLocalServer } from '../src/local/server.js';
import { ACTOR, AUDIENCE, TIER_GROUP, TIER_GROUP_AIRLINE, startFakeIdp } from './localFakeIdp.js';

export const SECRET = ['ab', 'cd', '12', '34'].join('').repeat(8);

// authorize: the broker's ask (or a stub of it) to run the rig with the tool server's PingOne Authorize branch on (init `authorize: true`); absent means the lab's own policy answers.
export async function startRig({ tierGroup = TIER_GROUP, tierGroupAirline = TIER_GROUP_AIRLINE, jwks = { timeoutMs: 15_000 }, bodyDeadlineMs, authorize } = {}) {
  const idp = await startFakeIdp();
  const clock = { t: Date.now() };
  const config = { issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], tierGroup, tierGroupAirline, hitlSecret: SECRET, clockSkewSeconds: 60, ...(typeof authorize === 'function' ? { authorize: true } : {}) };
  const local = await startLocalServer({ config, now: () => clock.t, jwks, ...(bodyDeadlineMs ? { bodyDeadlineMs } : {}), ...(typeof authorize === 'function' ? { authorize } : {}) });
  const origin = `http://127.0.0.1:${local.port}`;
  const seen = [];     // every response this rig saw: { status, headers, text }

  // A raw request, so a test can set Host, Origin and the rest freely. Resolves { status, headers (lower-case, plain object), text, json }.
  function raw(path, { method = 'GET', headers = {}, body, host } = {}) {
    return new Promise((resolve, reject) => {
      const h = { host: host ?? `127.0.0.1:${local.port}`, ...headers };
      if (body !== undefined) { h['content-length'] = Buffer.byteLength(body); }
      const req = http.request({ host: '127.0.0.1', port: local.port, path, method, headers: h }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = null; }
          const out = { status: res.statusCode, headers: res.headers, text, json };
          seen.push(out);
          resolve(out);
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  const token = (over = {}, opts = {}) => idp.mint(over, { nowMs: clock.t, ...opts });
  const post = (message, { tok, session, headers = {} } = {}) => raw('/mcp', {
    method: 'POST', body: typeof message === 'string' ? message : JSON.stringify(message),
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(session ? { 'mcp-session-id': session } : {}), ...headers },
  });
  let nextId = 1;
  const rpc = (method, params, o) => post({ jsonrpc: '2.0', id: nextId++, method, params }, o);
  async function open(tok) {
    const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, { tok });
    return r.headers['mcp-session-id'];
  }
  // One tool call in a session. Returns the raw response plus `result` (the structured payload) when it succeeded.
  async function call(name, args, { tok, session, headers } = {}) {
    const s = session ?? await open(tok);
    const r = await rpc('tools/call', { name, arguments: args }, { tok, session: s, headers });
    return { ...r, result: r.json?.result?.structuredContent ?? null, session: s };
  }
  async function list(tok) {
    const s = await open(tok);
    const r = await rpc('tools/list', {}, { tok, session: s });
    return r.json.result.tools.map((t) => t.name);
  }
  const hitl = (path, { method = 'POST', body, secret = SECRET } = {}) => raw(`/hitl/challenges${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(secret ? { 'x-hitl-internal-secret': secret } : {}) },
  });
  return {
    idp, clock, local, origin, config, seen, raw, token, post, rpc, open, call, list, hitl,
    close: async () => { await local.close(); await idp.close(); },
  };
}
