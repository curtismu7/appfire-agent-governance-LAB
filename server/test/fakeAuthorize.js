// A fake PingOne Authorize decision endpoint, mounted by fakePingone.js on the fake's own loopback port. It is not PingOne: it answers the one decision-endpoint call the lab makes
// (docs/design-authorize-lab.md E.1) the way the owner's real endpoint was measured to answer it (section 0 facts), and records what it was sent. It proves the lab's READING only.
// The worker client's id and secret are assembled at run time, so no secret-shaped string sits in the repository.
//
//   POST /v1/environments/<env>/decisionEndpoints/<endpoint id>   Authorization: Bearer <a token this fake minted>, Content-Type: application/json, body { parameters: { 7 strings } }
//   POST /<env>/as/token                                           client_credentials for the Authorize worker client (Basic checked, wrong secret 401, NO scope accepted)
//
// The `ok` answer is S's OWN hand-written reading of the 21-case table (design F), written from the parameters alone: it does not import the lab's policy or the reader, so a
// disagreement between the lab rule, this fake and the reader fails a test instead of passing by construction. Every answer also carries the shared tree's FOREIGN codes.
import { randomBytes, randomUUID } from 'node:crypto';

export const AUTHORIZE_CLIENT_ID = '12121212-3434-4565-8787-9a9a9a9a9a9a';
export const AUTHORIZE_CLIENT_SECRET = ['fake', '-authorize-', 'worker-secret-', 'for-tests-', 'a1b2c3d4e5f60789'].join('');
export const AUTHORIZE_ENDPOINT_ID = 'e4e4e4e4-5656-4787-8989-b0b0b0b0b0b0';
export const authorizeSettings = (extra = {}) => ({
  AAG_AUTHORIZE_ENDPOINT_ID: AUTHORIZE_ENDPOINT_ID, AAG_AUTHORIZE_CLIENT_ID: AUTHORIZE_CLIENT_ID, AAG_AUTHORIZE_CLIENT_SECRET: AUTHORIZE_CLIENT_SECRET, ...extra,
});
const PARAM_NAMES = ['AirLabMarker', 'ToolName', 'UserId', 'AirFare', 'AirIsInternational', 'AirCabinAsked', 'AirApproval'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const basicOf = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

const FOREIGN = { code: 'transaction-approved', name: 'transaction approved', payload: JSON.stringify({ outcome: 'permit', note: 'another demo' }) };
const CONSENT = { code: 'HITL_CONSENT', name: 'consent required', payload: JSON.stringify({ outcome: 'consent' }) };
const CATCH_ALL = { code: 'airline-unmatched', name: 'unmatched', payload: JSON.stringify({ outcome: 'unmatched' }) };
const statement = (code, outcome, extra = {}) => ({ code, name: code.replace(/-/g, ' '), payload: JSON.stringify({ outcome, ...extra }) });

// The hand-written reading of the table (F): which ONE specific code a complete request gets, or why it gets none.
// Returns { code, outcome } | { none: 'only-unmatched' | 'no-code' | 'indeterminate' }.
export function reading(p) {
  if (p.AirLabMarker !== 'larkspur-air' || p.ToolName !== 'book_airline_flight' || p.UserId === '') return { none: 'no-code' };
  if (!/^\d+(\.\d+)?$/.test(p.AirFare)) return { none: 'indeterminate' };
  const fare = Number(p.AirFare);
  if (!(fare > 0)) return { none: 'no-code' };
  if (!['business', 'economy'].includes(p.AirCabinAsked)) return { none: 'only-unmatched' };
  if (!['none', 'verified'].includes(p.AirApproval)) return { none: 'only-unmatched' };
  const intl = String(p.AirIsInternational).toLowerCase() === 'true';   // the engine is LENIENT: 'True' reads true, 'maybe' reads false
  if (fare > 1500) return p.AirApproval === 'verified' ? { code: 'airline-approved-as-asked', outcome: 'approved' } : { code: 'airline-approval-required', outcome: 'approval-required' };
  const over = fare > 400;
  if (p.AirCabinAsked === 'business' && (intl || over)) {
    return { code: intl && over ? 'airline-economy-intl-over-limit' : intl ? 'airline-economy-intl' : 'airline-economy-over-limit', outcome: 'narrow' };
  }
  return { code: 'airline-permit-as-asked', outcome: 'permit' };
}

export function createFakeAuthorize({ envId }) {
  const state = { mode: 'ok', seen: [], tokenRequests: 0, minted: new Set(), revoked: new Set(), tooMany: 0, held: [] };

  const envelope = (decision, statements, extra = {}) => ({ decision, statements, status: { code: 'OKAY' }, correlationId: randomUUID(), elapsedMicroseconds: 1234, ...extra });
  const withForeign = (list, { consent = false } = {}) => [...list, FOREIGN, ...(consent ? [CONSENT] : [])];
  const specificList = (r, { catchAll = true } = {}) => [statement(r.code, r.outcome, r.outcome === 'narrow' ? { cabin: 'economy' } : {}), ...(catchAll ? [CATCH_ALL] : [])];

  // One place to correct an answer's shape: (mode, parameters) -> { status, type, body (object or string) }.
  function answer(mode, p) {
    const json = (body, type = 'application/json') => ({ status: 200, type, body });
    const r = reading(p);
    const okBody = ({ catchAll = true } = {}) => {
      const consent = Number(p.AirFare) > 1500;
      if (r.code) return envelope(r.code === 'airline-booking-refused' ? 'DENY' : 'PERMIT', withForeign(specificList(r, { catchAll }), { consent }));
      if (r.none === 'indeterminate') return envelope('INDETERMINATE', [], { status: { code: 'OKAY' } });
      if (r.none === 'only-unmatched') return envelope('PERMIT', withForeign(catchAll ? [CATCH_ALL] : []));
      return envelope('PERMIT', withForeign([]));
    };
    switch (mode) {
      case 'ok': return json(okBody());
      case 'ok-no-catchall': return json(okBody({ catchAll: false }));
      case 'hal-json': return json({ ...okBody(), _links: { self: { href: 'https://api.pingone.example/decision' } }, authorizationVersion: { id: randomUUID() }, timestamp: '2026-11-17T00:00:00Z', extra: { a: 1 } }, 'application/hal+json;charset=UTF-8');
      case 'second-factor': return json(envelope('PERMIT', withForeign([statement('airline-second-factor-required', 'second-factor-required'), CATCH_ALL])));
      case 'deny': return json(envelope('DENY', withForeign([statement('airline-booking-refused', 'refused'), CATCH_ALL])));
      case 'only-unmatched': return json(envelope('PERMIT', withForeign([CATCH_ALL])));
      case 'no-airline-code': return json(envelope('PERMIT', withForeign([], { consent: true })));
      case 'not-applicable': return json(envelope('NOT_APPLICABLE', []));
      case 'indeterminate': return json(envelope('INDETERMINATE', []));
      case 'indeterminate-status': return json({ ...okBody(), status: { code: 'ERROR' } });
      case 'two-specific-codes': return json(envelope('PERMIT', withForeign([statement('airline-permit-as-asked', 'permit'), statement('airline-economy-intl', 'narrow', { cabin: 'economy' }), CATCH_ALL])));
      case 'unknown-airline-code': return json(envelope('PERMIT', withForeign([statement('airline-cabin-first', 'permit'), CATCH_ALL])));
      case 'decision-code-mismatch': return json(envelope('DENY', withForeign([statement('airline-permit-as-asked', 'permit'), CATCH_ALL])));
      case 'decision-code-mismatch-2': return json(envelope('PERMIT', withForeign([statement('airline-booking-refused', 'refused'), CATCH_ALL])));
      case 'payload-contradicts-code': return json(envelope('PERMIT', withForeign([statement('airline-economy-intl', 'narrow', { cabin: 'first' }), CATCH_ALL])));
      case 'payload-contradicts-code-2': return json(envelope('PERMIT', withForeign([statement('airline-permit-as-asked', 'refused'), CATCH_ALL])));
      case 'permit-extra-fields': {
        // a valid permit with extra statement fields, __proto__ and constructor members and a 5 KB code in a foreign statement (the members are written as text: JSON.stringify would drop none of them)
        const good = JSON.stringify(statement('airline-permit-as-asked', 'permit'));
        const text = `{"decision":"PERMIT","statements":[${good.slice(0, -1)},"extra":"yes","__proto__":{"code":"airline-booking-refused"},"constructor":{"code":"x"}},{"code":"${'x'.repeat(5000)}","name":"long"},${JSON.stringify(FOREIGN)}],"status":{"code":"OKAY"},"correlationId":"${randomUUID()}","__proto__":{"decision":"DENY"},"unknownTop":[1,2,3]}`;
        return json(text);
      }
      case 'bad-json': return json('{"decision": "PERMIT", "statements": [');
      case 'wrong-content-type': return json(JSON.stringify(okBody()), 'text/html');
      case 'wrong-content-type-textjson': return json(JSON.stringify(okBody()), 'text/json');
      case 'wrong-content-type-plain': return json(JSON.stringify(okBody()), 'text/plain');
      case 'wrong-content-type-octet': return json(JSON.stringify(okBody()), 'application/octet-stream');
      case 'oversize': return json(JSON.stringify(envelope('PERMIT', withForeign([statement('airline-permit-as-asked', 'permit')]), { filler: 'x'.repeat(70_000) })));
      case 'statements-object': return json({ ...okBody(), statements: { code: 'airline-permit-as-asked' } });
      case 'decision-lowercase': return json({ ...okBody(), decision: 'permit' });
      case 'redirect': return { status: 302, type: 'application/json', body: '', headers: { location: 'http://127.0.0.1:1/never-followed' } };
      case '5xx': return { status: 500, type: 'application/json', body: { error: 'internal' } };
      case '5xx-503': return { status: 503, type: 'application/json', body: { error: 'unavailable' } };
      case 'forbidden': return { status: 403, type: 'application/json', body: { code: 'ACCESS_FAILED' } };
      case 'not-found': return { status: 404, type: 'application/json', body: { code: 'NOT_FOUND' } };
      case 'bad-request': return { status: 400, type: 'application/json', body: { code: 'INVALID_REQUEST' } };
      default: return json(okBody());
    }
  }

  const sendRaw = (res, a) => {
    const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    res.writeHead(a.status, { 'content-type': a.type, ...(a.headers ?? {}) });
    res.end(body);
  };
  const mintToken = () => { const t = `az-${randomBytes(18).toString('hex')}`; state.minted.add(t); return t; };

  // handle(req, res, url, bodyText): true when this fake answered (a token request of the Authorize client or a call to the decision endpoint).
  function handle(req, res, url, bodyText) {
    const auth = String(req.headers.authorization ?? '');
    // the token endpoint, for the Authorize worker client only (any other client falls through to fakePingone)
    if (req.method === 'POST' && url.pathname === `/${envId}/as/token`) {
      const asked = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8') : '';
      if (!asked.startsWith(`${AUTHORIZE_CLIENT_ID}:`)) return false;
      if (asked !== `${AUTHORIZE_CLIENT_ID}:${AUTHORIZE_CLIENT_SECRET}`) { sendRaw(res, { status: 401, type: 'application/json', body: { error: 'invalid_client', error_description: 'fake: the worker client credentials are not valid' } }); return true; }
      const form = Object.fromEntries(new URLSearchParams(bodyText));
      if (form.grant_type !== 'client_credentials' || Object.keys(form).length !== 1) { sendRaw(res, { status: 400, type: 'application/json', body: { error: 'invalid_request', error_description: 'fake: client_credentials with no scope and no audience only' } }); return true; }
      state.tokenRequests += 1;
      sendRaw(res, { status: 200, type: 'application/json', body: { access_token: mintToken(), token_type: 'Bearer', expires_in: 3600 } });
      return true;
    }
    const m = /^\/v1\/environments\/([^/]+)\/decisionEndpoints\/([^/]+)$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== 'POST') { sendRaw(res, { status: 405, type: 'application/json', body: { code: 'METHOD' } }); return true; }
    const bearer = /^Bearer (.+)$/.exec(auth)?.[1];
    if (!bearer || !state.minted.has(bearer)) { sendRaw(res, { status: 401, type: 'application/json', body: { code: 'UNAUTHORIZED' } }); return true; }
    if (String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') { sendRaw(res, { status: 415, type: 'application/json', body: { code: 'UNSUPPORTED_MEDIA_TYPE' } }); return true; }
    let doc = null; try { doc = JSON.parse(bodyText); } catch { doc = null; }
    const p = doc?.parameters;
    const shapeOk = doc && typeof doc === 'object' && Object.keys(doc).join() === 'parameters' && p && typeof p === 'object' && !Array.isArray(p)
      && Object.keys(p).length === PARAM_NAMES.length && PARAM_NAMES.every((k) => typeof p[k] === 'string');
    if (!shapeOk || m[1] !== envId || !UUID.test(m[2])) { sendRaw(res, { status: 400, type: 'application/json', body: { code: 'INVALID_REQUEST' } }); return true; }
    if (m[2] !== AUTHORIZE_ENDPOINT_ID) { sendRaw(res, { status: 404, type: 'application/json', body: { code: 'NOT_FOUND' } }); return true; }
    const entry = { at: Date.now(), parameters: { ...p }, bearer: true, mode: state.mode, status: null };
    state.seen.push(entry);
    const mode = state.mode;
    if (mode === 'unauthorized-then-ok') {
      // the first bearer this fake sees on a decision call is treated as expired: 401, once; a freshly minted token then works
      if (!state.revoked.size) { state.revoked.add(bearer); }
      if (state.revoked.has(bearer)) { entry.status = 401; sendRaw(res, { status: 401, type: 'application/json', body: { code: 'UNAUTHORIZED', message: 'fake: the token has expired' } }); return true; }
      const a = answer('ok', p); entry.status = a.status; sendRaw(res, a); return true;
    }
    if (mode === '429-then-ok' || mode === '429-always') {
      state.tooMany += 1;
      if (mode === '429-always' || state.tooMany === 1) { entry.status = 429; sendRaw(res, { status: 429, type: 'application/json', body: { code: 'TOO_MANY_REQUESTS' }, headers: { 'retry-after': '1' } }); return true; }
      const a = answer('ok', p); entry.status = a.status; sendRaw(res, a); return true;
    }
    if (mode === 'timeout') { state.held.push(res); return true; }                              // never answers: the headers deadline
    if (mode === 'slow-body') {                                                                  // headers, then a stalled body
      res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"decision":"PERMIT","statements":['); state.held.push(res); entry.status = 200; return true;
    }
    const a = answer(mode, p);
    entry.status = a.status;
    sendRaw(res, a);
    return true;
  }

  const release = () => { for (const r of state.held.splice(0)) { try { r.destroy(); } catch { /* gone */ } } };
  return {
    handle,
    setMode(name) { state.mode = name; state.tooMany = 0; },
    mode: () => state.mode,
    get seen() { return state.seen; },
    get tokenRequests() { return state.tokenRequests; },
    reset() { release(); state.mode = 'ok'; state.seen.length = 0; state.tokenRequests = 0; state.tooMany = 0; state.minted.clear(); state.revoked.clear(); },
    release,
    answer,                                            // the pure (mode, parameters) -> answer function, for the reader tests
  };
}
