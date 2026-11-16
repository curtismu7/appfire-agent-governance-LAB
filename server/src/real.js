// Full Real (owner, 2026-11-10): actual servers and an actual login (rule 19). The chain, every call made here and only here:
//   1. Sign-in: a PingOne authorize with response_mode=pi.flow + PKCE S256 for the user app (AAG_USER_CLIENT_*), the flows API username/password
//      step with the password the person typed in the Sign in dialog, then the code for tokens. No redirect is ever followed or served.
//   2. Agent token (the actor): client_credentials for the agent app (AAG_AGENT_CLIENT_*) with the agent scope (AAG_AGENT_SCOPE, default agent:invoke).
//   3. Exchange 1, RFC 8693 at PingOne: subject = the user's access token, actor = the agent token, scope = the agent scope. The resource that owns that
//      scope stamps act = the agent (its act attribute reads the actor token's client_id into act.sub).
//   4. Exchange 2: subject = the exchange-1 token, NO actor token, NO audience parameter, scope = AAG_GATEWAY_SCOPE. The gateway scope's resource chooses
//      the audience and passes the subject token's act through. This is the proven two-exchange pattern; one exchange (user + agent + gateway
//      scope together) mints a token with no act, which PingOne Authorize (HasValidActorChain) would deny. If the final token has no act the run
//      stops here and the gateway is never called.
//   5. The Agent Gateway (AAG_AGENT_GATEWAY_URL), as an MCP client: initialize, tools/list, tools/call (mcpClient.js; never a trusted-caller header).
//
// Secrets: the two client secrets are held in a closure and sent only in the Authorization header of a token call. The password is a function
// argument used once in one request body and kept nowhere: not stored, not logged, not returned, not in a hop (a hop shows a fixed placeholder).
// Real tokens are shown raw in the run's token list AND in the hop details (rule 4: tokens are education; owner 2026-11-14: nothing token-shaped is redacted in this demo, nor are the
// authorization code, state, nonce, PKCE verifier or flow cookies). Only the password and the client secrets stay write-only; the refresh token is dropped.
// Every PingOne call goes through assertAuthUrl(): https (http only to a loopback fake), the configured environment, one of four fixed paths.
import { createHash, randomBytes } from 'node:crypto';
import { isLoopbackHost } from './safety.js';
import { formatTraceparent, newTrace } from './trace.js';
import { enrichHop } from './vendor/hopDetail.mjs';
import HOP_CATALOG from './vendor/hop-catalog.json' with { type: 'json' };
import { createGatewaySession, gatewayUrlProblem, parseAuditTrail } from './mcpClient.js';
import { realExchange } from './gatewayExchanges.js';
import { NEEDS_ACCOUNTS, toolArgs } from './realGate.js';
import { situationOf } from './situations.js';
import { cleanFree } from './credentials.js';
import { A2A_REQUIRED, DEFAULT_AGENT_SCOPE, FULL_REQUIRED, isPlaceholder } from './settings.js';

export const TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_IN_FLIGHT = 2;
export const MAX_SESSIONS = 500;
// The redirect URI the user app must list. pi.flow never redirects: PingOne only checks that it matches the app; nothing is ever served there.
// It is one of the two URIs scripts/owner/pingone-real-setup.mjs registers on the user app.
export const REDIRECT_URI = 'http://127.0.0.1:7813/callback';
// The sign-in asks for the OIDC scopes, the gateway scope (AAG_GATEWAY_SCOPE) and the agent scope (AAG_AGENT_SCOPE) when the
// user app is granted them. The agent scope on the user token is what PingOne's may_act attribute resolves from (the
// agent-scope resource stamps may_act = the actor the user consented to), so the exchange-1 resource can pass it through as act.
export const SIGN_IN_SCOPES = 'openid profile email';
export const PASSWORD_SHOWN = '[typed by you in the Sign in dialog: sent once to PingOne, never stored, logged or shown]';
const SECRET_SHOWN = 'Basic [write-only: the client secret is never shown]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGION_TLD = { na: 'com', us: 'com', com: 'com', eu: 'eu', ca: 'ca', ap: 'asia', asia: 'asia' };
const TX = 'urn:ietf:params:oauth:grant-type:token-exchange';
const AT = 'urn:ietf:params:oauth:token-type:access_token';
const PW_TYPE = 'application/vnd.pingidentity.usernamePassword.check+json';
const EX1_TITLE = 'Exchange 1: act = agent';
const EX2_TITLE = 'Exchange 2: for the gateway';
const A2A_EX1_TITLE = 'A2A exchange 1: act = agent 1';
const A2A_ACTOR2_TITLE = 'A2A actor token: the specialist';
const A2A_EX2_TITLE = 'A2A exchange 2: nested act';
// The act claim (an RFC 8693 object that names the actor in sub), or null when the claims have none: an empty object, an array or a string is no act.
const actOf = (claims) => {
  if (!claims) return null;
  // PingOne sometimes serializes the nested act object as a JSON string; accept both shapes.
  let act = claims.act;
  if (typeof act === 'string') { try { act = JSON.parse(act); } catch { return null; } }
  return act && typeof act === 'object' && !Array.isArray(act) && typeof act.sub === 'string' && act.sub !== '' ? act : null;
};
// What the hop shows of it: the actor's sub only, or ABSENT.
const actShown = (act) => (act ? { sub: act.sub.slice(0, 200) } : 'ABSENT'); // actOf guarantees a string sub
// The reply when the delegated token has no act claim. The same words either way; after exchange 2 it also points at the pass-through.
const noActText = (agentScope, afterExchange2) => `Stopped before the gateway, nothing was sent to it: the delegated token carries no act claim: check the ${agentScope} resource's act attribute.${afterExchange2 ? ' Exchange 1 had the claim, so also check that the gateway scope\'s resource passes the subject token\'s act through (a PingOne change for the owner; this lab never edits that resource).' : ''}`;

export class RealRefused extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

const plain = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const SCOPE_LIST = /^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/;

// The optional A2A settings (AAG_A2A_*): { a2a } when all six are set and valid, { a2a: null } when none is, { a2a: null, a2aProblem } when some are not
// (fixed words naming the setting, never a value). A2A use cases then stay on the labelled mock engine and say why.
function a2aFrom(s) {
  const has = (k) => typeof s[k] === 'string' && s[k] !== '' && !isPlaceholder(s[k]);
  if (!A2A_REQUIRED.some(has)) return { a2a: null };
  const absent = A2A_REQUIRED.filter((k) => !has(k));
  if (absent.length) return { a2a: null, a2aProblem: `the app .env sets some AAG_A2A_* names but not ${absent.join(', ')}` };
  for (const [k, max] of [['AAG_A2A_AGENT_CLIENT_ID', 200], ['AAG_A2A_AGENT_CLIENT_SECRET', 512], ['AAG_A2A_INTERMEDIATE_AUDIENCE', 300], ['AAG_A2A_GATEWAY_AUDIENCE', 300]]) {
    if (!plain(s[k], max)) return { a2a: null, a2aProblem: `the app .env has no valid ${k}` };
  }
  if (!plain(s.AAG_A2A_INTERMEDIATE_SCOPE, 300) || !SCOPE_LIST.test(s.AAG_A2A_INTERMEDIATE_SCOPE) || s.AAG_A2A_INTERMEDIATE_SCOPE.includes(' ')) return { a2a: null, a2aProblem: 'the app .env has no valid AAG_A2A_INTERMEDIATE_SCOPE (one scope name)' };
  if (!plain(s.AAG_A2A_SCOPE, 300) || !SCOPE_LIST.test(s.AAG_A2A_SCOPE)) return { a2a: null, a2aProblem: 'the app .env has no valid AAG_A2A_SCOPE' };
  return { a2a: { agent2: { id: s.AAG_A2A_AGENT_CLIENT_ID, secret: s.AAG_A2A_AGENT_CLIENT_SECRET, authMethod: s.AAG_A2A_AGENT_TOKEN_AUTH === 'CLIENT_SECRET_POST' ? 'post' : 'basic' }, intermediateAud: s.AAG_A2A_INTERMEDIATE_AUDIENCE, intermediateScope: s.AAG_A2A_INTERMEDIATE_SCOPE, gatewayAud: s.AAG_A2A_GATEWAY_AUDIENCE, scope: s.AAG_A2A_SCOPE } };
}

// settings: the full-Real names from the app's .env. Returns the config, or { problem } in fixed words naming the setting (never a value).
export function realConfig(settings = {}, env = {}) {
  const environmentId = String(settings.PINGONE_ENVIRONMENT_ID || '');
  if (!UUID.test(environmentId)) return { problem: 'the app .env has no valid PINGONE_ENVIRONMENT_ID' };
  for (const [k, max] of [['AAG_USER_CLIENT_ID', 200], ['AAG_USER_CLIENT_SECRET', 512], ['AAG_AGENT_CLIENT_ID', 200], ['AAG_AGENT_CLIENT_SECRET', 512], ['AAG_DEMO_USERNAME', 200], ['AAG_GATEWAY_AUDIENCE', 300]]) {
    if (!plain(settings[k], max)) return { problem: `the app .env has no valid ${k}` };
  }
  if (!plain(settings.AAG_GATEWAY_SCOPE, 300) || !SCOPE_LIST.test(settings.AAG_GATEWAY_SCOPE)) return { problem: 'the app .env has no valid AAG_GATEWAY_SCOPE' };
  // Optional: absent or empty is the default.
  const agentScope = settings.AAG_AGENT_SCOPE === undefined || settings.AAG_AGENT_SCOPE === '' ? DEFAULT_AGENT_SCOPE : settings.AAG_AGENT_SCOPE;
  // One scope name (the owner's setup script looks one up), and not the gateway scope: exchange 1 must go to the resource that owns the agent scope.
  if (!plain(agentScope, 300) || !SCOPE_LIST.test(agentScope) || agentScope.includes(' ')) return { problem: 'the app .env has no valid AAG_AGENT_SCOPE (one scope name)' };
  if (settings.AAG_GATEWAY_SCOPE.split(' ').includes(agentScope)) return { problem: 'the app .env has AAG_AGENT_SCOPE equal to AAG_GATEWAY_SCOPE: exchange 1 needs the agent scope, not the gateway scope' };
  const gwProblem = gatewayUrlProblem(settings.AAG_AGENT_GATEWAY_URL);
  if (gwProblem) return { problem: `the app .env has no valid AAG_AGENT_GATEWAY_URL (${gwProblem.replace('AAG_AGENT_GATEWAY_URL ', '')})` };
  let base;
  if (env.AAG_LIVE_TEST_BASE) {
    try {
      const u = new URL(env.AAG_LIVE_TEST_BASE);
      if (u.protocol !== 'http:' || !isLoopbackHost(u.hostname) || u.username || u.password || u.pathname.replace(/\/+$/, '') !== `/${environmentId}`) throw new Error('bad');
      base = `${u.origin}/${environmentId}`;
    } catch { return { problem: 'AAG_LIVE_TEST_BASE must be http on a loopback host with the environment id as its path' }; }
  } else {
    const tld = REGION_TLD[String(settings.PINGONE_REGION || 'com').toLowerCase()];
    if (!tld) return { problem: 'the app .env has no valid PINGONE_REGION (com, eu, ca or asia)' };
    base = `https://auth.pingone.${tld}/${environmentId}`;
  }
  return {
    ...a2aFrom(settings), environmentId, base, gatewayUrl: new URL(settings.AAG_AGENT_GATEWAY_URL).toString(), audience: settings.AAG_GATEWAY_AUDIENCE, scope: settings.AAG_GATEWAY_SCOPE, agentScope, username: settings.AAG_DEMO_USERNAME,
    user: { id: settings.AAG_USER_CLIENT_ID, secret: settings.AAG_USER_CLIENT_SECRET }, agent: { id: settings.AAG_AGENT_CLIENT_ID, secret: settings.AAG_AGENT_CLIENT_SECRET, authMethod: settings.AAG_AGENT_TOKEN_AUTH === 'CLIENT_SECRET_POST' ? 'post' : 'basic' },
  };
}

// The last check before a PingOne socket opens: the configured origin, https (http only on loopback), no credentials, one of the fixed paths.
const FLOW_ID = /^[A-Za-z0-9-]{1,64}$/;
export function assertAuthUrl(target, base) {
  let url; let allowed;
  try { url = new URL(target); allowed = new URL(base); } catch { throw new RealRefused('bad_url', 'Not a URL'); }
  if (url.username || url.password) throw new RealRefused('credentials_in_url', 'Outbound URLs must not carry credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) throw new RealRefused('not_https', 'Outbound calls are https only');
  if (url.origin !== allowed.origin) throw new RealRefused('other_origin', 'Outbound calls may only reach the configured PingOne environment');
  const p = allowed.pathname.replace(/\/+$/, '');
  const rest = url.pathname.startsWith(`${p}/`) ? url.pathname.slice(p.length) : null;
  const ok = rest === '/as/authorize' || rest === '/as/token' || rest === '/as/resume' || (rest !== null && rest.startsWith('/flows/') && FLOW_ID.test(rest.slice(7)));
  if (!ok || url.hash) throw new RealRefused('other_path', 'Outbound calls may only reach authorize, the flows API, resume and the token endpoint');
  if (url.search && rest !== '/as/authorize' && rest !== '/as/resume') throw new RealRefused('other_path', 'Only authorize and resume take a query');
  return url;
}

const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
export function decodeJwt(raw) {
  const parts = String(raw).split('.');
  if (parts.length !== 3) return null;
  try { const header = JSON.parse(b64(parts[0])); const claims = JSON.parse(b64(parts[1])); return header && claims && typeof claims === 'object' ? { header, claims } : null; } catch { return null; }
}
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null);
// The same form the owner verified on the identity-provider-only path (live.js): id:secret, base64.
const basic = (c) => `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString('base64')}`;

async function readCapped(response, max) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) { chunks.push(value.subarray(0, max - total)); await reader.cancel().catch(() => {}); return { text: Buffer.concat(chunks).toString('utf8'), truncated: true }; }
    chunks.push(value); total += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

// A PingOne error in its own words (code and message, cut short); nothing else of the answer.
const p1Error = (r) => (r.json ? { error: str(r.json.error) ?? str(r.json.code), error_description: str(r.json.error_description) ?? str(r.json.message) ?? str(r.json.details?.[0]?.message), detail_code: str(r.json.details?.[0]?.code) } : { note: r.unreachable ? 'no answer' : r.redirected ? 'a redirect (never followed)' : 'the answer was not a JSON object' });
// After the password has been sent, PingOne's free text is never passed on (it could echo what was typed): codes only.
const p1Codes = (r) => (r.json ? { error: str(r.json.error, 80) ?? str(r.json.code, 80), detail_code: str(r.json.details?.[0]?.code, 80) } : p1Error(r));
// PingOne's own error words can echo what was sent (a client secret): the free-text fields of an answer are scrubbed of the two client secrets before any of it is kept
// (hop details, replies). Tokens are shown raw (owner 2026-11-14), so a JWT echoed in an error stays; the secrets never do.
export function scrubError(json, secrets = []) {
  const clean = (v) => (typeof v === 'string' ? secrets.filter((x) => typeof x === 'string' && x.length >= 4).reduce((t, x) => t.split(x).join('[secret]'), v) : v);
  const out = { ...json };
  for (const k of ['error', 'error_description', 'message', 'code']) if (k in out) out[k] = clean(out[k]);
  if (Array.isArray(out.details)) out.details = out.details.map((d) => (d && typeof d === 'object' ? { ...d, ...('message' in d ? { message: clean(d.message) } : {}), ...('code' in d ? { code: clean(d.code) } : {}) } : d));
  return out;
}
const failText = (r, who = 'PingOne') => (r.unreachable ? `${who} did not answer (no connection, a timeout or an unreadable answer).` : r.redirected ? `${who} answered with a redirect; the lab never follows one.` : r.truncated ? 'The answer was larger than the lab reads, so it was cut off.' : `${who} answered HTTP ${r.status}.`);

export function createReal({ config = { problem: 'not configured' }, missing = FULL_REQUIRED, wanted = false, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, now = Date.now, gatewayFetch } = {}) {
  const configured = () => !config.problem;
  const sessions = new Map(); // workspace id -> { accessToken, claims, idClaims, expiresAt, steps }
  // The PingOne session (owner, 2026-11-16: "once logged in, I should not have to login again. Use P1 session"): the cookies PingOne set during the last
  // password sign-in, kept in memory only for this process (never returned, logged or put in a hop except the flow's own steps, never written to disk).
  // A workspace with no valid token (a new tab, an expired token, a Reset) signs in again by sending them to authorize: PingOne answers COMPLETED with a code
  // while its own session lives, and no password is needed. The password sign-in remains the fallback. UNVERIFIED against a real tenant.
  let sso = null; // { cookies: Map(name -> value) } or null
  let lastSilentFail = -Infinity;
  let inFlight = 0;

  async function p1(url, init, traceparent) {
    const target = assertAuthUrl(url, config.base);
    let response; let body = { text: '', truncated: false };
    try {
      response = await fetchImpl(target.toString(), { ...init, headers: { ...init.headers, traceparent }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      body = await readCapped(response, maxBytes);
    } catch { return { status: 0, unreachable: true, json: null, cookies: [] }; }
    let json = null;
    if (!body.truncated && body.text) { try { const j = JSON.parse(body.text); json = j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { json = null; } }
    if (json) json = scrubError(json, [config.user?.secret, config.agent?.secret, config.a2a?.agent2.secret]);
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    return { status: response.status, redirected: response.status >= 300 && response.status < 400, json, truncated: body.truncated, cookies };
  }
  const tokenCall = (form, client, traceparent) => {
    // CLIENT_SECRET_POST apps (e.g. PingOne AI_AGENT type) refuse the Basic header; the rest keep Basic (write-only either way).
    const headers = client.authMethod === 'post'
      ? { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
      : { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: basic(client) };
    const body = client.authMethod === 'post' ? new URLSearchParams({ ...form, client_id: client.id, client_secret: client.secret }).toString() : new URLSearchParams(form).toString();
    return p1(`${config.base}/as/token`, { method: 'POST', headers, body }, traceparent);
  };

  const sessionOf = (ws) => {
    const s = sessions.get(ws);
    if (!s) return null;
    if (s.expiresAt <= now()) { sessions.delete(ws); return null; }
    return s;
  };

  // The pi.flow sign-in. password: what the person typed (a string). Returns { ok: true, user, steps } or { ok: false, status, error, message, steps }.
  // The password is used in one request body below and is not kept anywhere; `steps` (what the dialog and the Sign-in hop show) never carry it.
  async function signIn(ws, password, traceparentIn, { silent = false } = {}) {
    if (!configured()) throw new RealRefused('not_configured', config.problem, 503);
    if (silent && !sso) return { ok: false, status: 401, error: 'no_p1_session', message: 'There is no PingOne session to use: sign in with your password.', steps: [] };
    if (inFlight >= MAX_IN_FLIGHT) throw new RealRefused('busy', 'two Real calls are already in flight; wait for one to finish', 429);
    if (!sessions.has(ws) && sessions.size >= MAX_SESSIONS) throw new RealRefused('too_many', 'too many signed-in workspaces; Reset one first', 429);
    inFlight += 1;
    const trace = newTrace(traceparentIn, `signin:${ws}`);
    const tp = () => formatTraceparent(trace.traceId, trace.span());
    const steps = [];
    const jar = new Map(silent ? sso.cookies : []);
    const keep = (cookies) => { for (const c of cookies) { const pair = String(c).split(';')[0]; const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1)); } };
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let sent = false; // true once the password has gone to PingOne: from then on, only error codes are kept
    // Belt and braces: the exact password, if it ever appears in what is returned, is replaced (only for passwords long enough to be unambiguous).
    const scrub = (v) => (typeof password === 'string' && password.length >= 4 ? JSON.parse(JSON.stringify(v).split(JSON.stringify(password).slice(1, -1)).join('[the password]')) : v);
    const fail = (status, error, message, r) => scrub({ ok: false, status, error, message, steps, ...(r ? { pingone: sent ? p1Codes(r) : p1Error(r) } : {}) });
    try {
      // 1. authorize, pi.flow: the answer is JSON (a flow), not a redirect.
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(12).toString('base64url');
      const nonce = randomBytes(12).toString('base64url');
      // PingOne refuses scopes from two custom resources in one authorize ("May not request scopes for multiple resources"),
      // so the sign-in asks for the agent scope only (the gateway scope arrives on the exchange-2 token, whose audience the
      // gateway-scope resource chooses). The agent scope on the user token is also what the resource's may_act attribute
      // resolves from, so the exchange-1 resource can stamp act.
      const query = { response_type: 'code', client_id: config.user.id, redirect_uri: REDIRECT_URI, scope: `${SIGN_IN_SCOPES} ${config.agentScope}`, response_mode: 'pi.flow', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, nonce };
      const t1 = tp();
      const a = await p1(`${config.base}/as/authorize?${new URLSearchParams(query)}`, { method: 'GET', headers: { accept: 'application/json', ...(silent && jar.size ? { cookie: cookieHeader() } : {}) } }, t1);
      keep(a.cookies);
      steps.push({ step: silent ? 'authorize (response_mode=pi.flow, PKCE S256, with your PingOne session: no password)' : 'authorize (response_mode=pi.flow, PKCE S256)', traceparent: t1, request: { method: 'GET', url: `${config.base}/as/authorize`, query }, response: { status: a.status, body: a.json ? { id: str(a.json.id, 64), status: str(a.json.status, 64), ...(a.status === 200 ? {} : p1Error(a)) } : p1Error(a), 'set-cookie': a.cookies.map(String) } });
      if (a.unreachable) return fail(503, 'signin_unreachable', 'PingOne did not answer the sign-in. Check the network, or switch to Mock.', a);
      if (a.status !== 200 || !a.json || !FLOW_ID.test(String(a.json.id || ''))) return fail(502, 'signin_refused', `PingOne refused to start the sign-in (${failText(a)}).`, a);
      let flow = a.json;
      const flowId = a.json.id; // checked against FLOW_ID above; later answers never change the id the lab calls
      if (flow.status !== 'USERNAME_PASSWORD_REQUIRED' && flow.status !== 'COMPLETED') return fail(409, 'signin_step_unsupported', 'PingOne asked for a sign-in step this lab does not drive (only username and password). Check the user app\'s sign-on policy.');
      // The PingOne session is gone (it ended or was never valid for this app): forget it, and ask for the password the usual way.
      if (silent && flow.status === 'USERNAME_PASSWORD_REQUIRED') { sso = null; return fail(401, 'p1_session_ended', 'The PingOne session has ended, so PingOne asked for the password again. Sign in once more.'); }
      // 2. username and password, once.
      if (flow.status === 'USERNAME_PASSWORD_REQUIRED') {
        const t2 = tp();
        sent = true;
        const r = await p1(`${config.base}/flows/${flowId}`, { method: 'POST', headers: { 'content-type': PW_TYPE, accept: '*/*', ...(jar.size ? { cookie: cookieHeader() } : {}) }, body: JSON.stringify({ username: config.username, password }) }, t2);
        keep(r.cookies);
        steps.push({ step: 'flows API: username and password', traceparent: t2, request: { method: 'POST', url: `${config.base}/flows/${flowId}`, headers: { 'content-type': PW_TYPE, cookie: cookieHeader() }, body: { username: config.username, password: PASSWORD_SHOWN } }, response: { status: r.status, body: r.json && r.status === 200 ? { id: str(r.json.id, 64), status: str(r.json.status, 64) } : p1Codes(r) } });
        if (r.unreachable) return fail(503, 'signin_unreachable', 'PingOne did not answer the sign-in. Check the network, or switch to Mock.', r);
        if (r.status === 400 || r.status === 401) return fail(401, 'signin_rejected', 'PingOne did not accept the username or password.', r);
        if (r.status !== 200 || !r.json) return fail(502, 'signin_refused', `PingOne refused the sign-in (${failText(r)}).`, r);
        flow = r.json;
        if (flow.status !== 'COMPLETED') return fail(409, 'signin_step_unsupported', 'PingOne asked for a step after the password that this lab does not drive (for example MFA). Check the user app\'s sign-on policy.');
      }
      // 3. the code: in the completed flow, or from resume with the flow's cookies.
      let code = str(flow.authorizeResponse?.code, 2000); let gotState = flow.authorizeResponse?.state;
      if (!code) {
        const t3 = tp();
        const r = await p1(`${config.base}/as/resume?flowId=${encodeURIComponent(flowId)}`, { method: 'GET', headers: { accept: 'application/json', ...(jar.size ? { cookie: cookieHeader() } : {}) } }, t3);
        keep(r.cookies); // the PingOne session cookie can arrive here too
        steps.push({ step: 'resume: the authorization code', traceparent: t3, request: { method: 'GET', url: `${config.base}/as/resume?flowId=${flowId}`, headers: { cookie: cookieHeader() } }, response: { status: r.status, body: r.json?.authorizeResponse ? { authorizeResponse: { code: str(r.json.authorizeResponse.code, 2000), state: str(r.json.authorizeResponse.state, 200) } } : p1Codes(r) } });
        if (r.unreachable) return fail(503, 'signin_unreachable', 'PingOne did not answer the sign-in. Check the network, or switch to Mock.', r);
        code = str(r.json?.authorizeResponse?.code, 2000); gotState = r.json?.authorizeResponse?.state;
        if (r.status !== 200 || !code) return fail(502, 'signin_refused', `PingOne did not hand back an authorization code (${failText(r)}).`, r);
      }
      if (gotState !== state) return fail(502, 'signin_refused', 'The authorization code came back without the state the lab sent; the lab refuses it.');
      // 4. code for tokens (the user app's secret in the Authorization header only).
      const t4 = tp();
      const tok = await tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI }, config.user, t4);
      const at = typeof tok.json?.access_token === 'string' ? tok.json.access_token : null;
      steps.push({ step: 'token: the code for the user\'s tokens', traceparent: t4, request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI } }, response: { status: tok.status, body: at ? { access_token: at, id_token: str(tok.json.id_token, 8000), token_type: str(tok.json.token_type), expires_in: Number.isFinite(tok.json.expires_in) ? tok.json.expires_in : null, scope: str(tok.json.scope) } : p1Codes(tok) } });
      if (tok.unreachable) return fail(503, 'signin_unreachable', 'PingOne did not answer the sign-in. Check the network, or switch to Mock.', tok);
      if (tok.status !== 200 || !at) return fail(502, 'signin_refused', `PingOne did not issue the user's tokens (${failText(tok)}).`, tok);
      const idClaims = typeof tok.json.id_token === 'string' ? decodeJwt(tok.json.id_token)?.claims ?? null : null;
      if (idClaims && idClaims.nonce !== nonce) return fail(502, 'signin_refused', 'The ID token does not carry the nonce the lab sent; the lab refuses it.');
      const dec = decodeJwt(at);
      const life = Number.isFinite(tok.json.expires_in) && tok.json.expires_in > 0 ? Math.min(tok.json.expires_in, 24 * 3600) : 3600;
      const session = { accessToken: at, header: dec?.header ?? null, claims: dec?.claims ?? null, idClaims, expiresAt: now() + life * 1000, steps, traceId: trace.traceId, viaP1Session: silent };
      sessions.set(ws, session);
      if (jar.size) sso = { cookies: new Map(jar) };
      return scrub({ ok: true, user: userOf(session), steps });
    } finally { inFlight -= 1; }
  }

  async function ensureSession(ws, traceparentIn) {
    const have = sessionOf(ws);
    if (have) return have;
    if (!configured() || !sso || now() - lastSilentFail < 5000) return null;
    try {
      const out = await signIn(ws, null, traceparentIn, { silent: true });
      if (out.ok) return sessionOf(ws);
    } catch { /* busy or not configured: no silent sign-in this time */ }
    lastSilentFail = now();
    return null;
  }

  const userOf = (s) => ({ sub: str(s.idClaims?.sub ?? s.claims?.sub, 120), name: str(s.idClaims?.preferred_username ?? s.idClaims?.name ?? s.idClaims?.email ?? config.username, 200), expiresAt: new Date(s.expiresAt).toISOString() });

  // One Real run of a use case the gate let through. session: the workspace's sign-in. Never throws for a refusal by PingOne or the gateway (those
  // are hops with a verdict and a mapped outcome); throws RealRefused('busy') when two Real calls are in flight.
  async function run(uc, { vertical, tool, traceparent, session, receipt = null, a2a = false }) {
    let challenge = null; // the gateway's HITL challenge id when the run holds for approval (never leaves here except via the return)
    if (!configured()) throw new RealRefused('not_configured', config.problem, 503);
    if (inFlight >= MAX_IN_FLIGHT) throw new RealRefused('busy', 'two Real calls are already in flight; wait for one to finish', 429);
    inFlight += 1;
    try {
      const trace = newTrace(traceparent, `real:${uc.id}`);
      const rootSpan = trace.span();
      const A2A = a2a && config.a2a ? config.a2a : null; // the chained A2A exchange (owner, 2026-11-16), only when the gate and the settings agree
      const tp = () => formatTraceparent(trace.traceId, trace.span());
      const hops = []; const tokens = [];
      const gw = []; // "What Privilege did" (rule 25): one record per call the lab's MCP client made to the gateway, returned as `gatewayTrace`
      const push = (h) => hops.push({ n: hops.length + 1, mock: false, live: false, source: 'real', ...h });
      // shortTitle: the name "Where each hop ran" shows (the two exchanges share one catalog kind, so the catalog title cannot tell them apart).
      const notRun = (kind, label, from, to, why, shortTitle) => hops.push({ n: hops.length + 1, mock: false, live: false, source: 'not-run', kind, label: `${label} [NOT RUN]`, from, to, verdict: 'skip', note: why, request: {}, response: {}, ...(shortTitle ? { shortTitle } : {}) });
      // expectAct: an exchange token; the page shows its act (or that it has none) next to the label.
      const addToken = (label, raw, notice, expectAct = false) => { const d = decodeJwt(raw); tokens.push({ label, mock: false, live: false, real: true, ...(expectAct ? { expectAct: true } : {}), notice, raw, header: d?.header ?? null, claims: d?.claims ?? { note: 'the token is opaque, not a JWT: there is nothing to decode' } }); };
      let outcome = null; let reply = null;
      const finishNotRun = (from, why) => {
        const rest = [['gateway-check', 'Agent Gateway', 'agent', 'gateway'], ['authorize-decision', 'Authorize decision', 'gateway', 'authorize'], ['tool-dispatched', 'MCP tool', 'gateway', 'mcp'], ['api-call', 'API', 'mcp', 'api'], ['agent-reply', 'Agent reply', 'agent', 'page']];
        for (const [kind, label, f, t] of rest.slice(from)) notRun(kind, label, f, t, why);
      };

      // 1. Sign-in (done in the dialog before this run): what happened, and the user's token.
      push({ kind: 'sign-in', label: session.viaP1Session ? 'Sign-in [REAL]: your PingOne session, pi.flow with no password this time (no redirect)' : 'Sign-in [REAL]: pi.flow with the password you typed in the Sign in dialog (no redirect)', from: 'browser', to: 'pingone', verdict: 'ok', traceparent: session.steps[0]?.traceparent ?? tp(), note: session.viaP1Session ? 'The lab used the PingOne session from your earlier sign-in: authorize with response_mode=pi.flow and PKCE S256 and the session cookie, then the code for tokens. No password was typed or sent.' : 'Done once in the Sign in dialog: authorize with response_mode=pi.flow and PKCE S256, the flows API username/password step, then the code for tokens. The password was sent once and is shown nowhere.', request: { steps: session.steps.map((s) => ({ step: s.step, ...s.request })) }, response: { steps: session.steps.map((s) => ({ step: s.step, ...s.response })), user: userOf(session) } });
      addToken('user access token (REAL, from the pi.flow sign-in)', session.accessToken, 'REAL token from your PingOne environment, shown raw for teaching (rule 4). It expires in minutes; secrets and your password are never shown.');

      // 2. Agent token (the actor), with the agent scope.
      const t2 = tp();
      const ag = await tokenCall({ grant_type: 'client_credentials', scope: config.agentScope }, config.agent, t2);
      const agent = typeof ag.json?.access_token === 'string' ? ag.json.access_token : null;
      push({ kind: 'actor-token', label: `Agent token [REAL]: the agent app's own client-credentials token (scope ${config.agentScope})`, from: 'agent', to: 'pingone', verdict: agent ? 'ok' : 'deny', traceparent: t2, note: agent ? 'The agent app (AAG_AGENT_CLIENT_ID) authenticated with its own secret (write-only). This is the actor token for exchange 1.' : failText(ag), request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: 'client_credentials', scope: config.agentScope } }, response: { status: ag.status, body: agent ? { access_token: agent, token_type: str(ag.json.token_type), expires_in: Number.isFinite(ag.json.expires_in) ? ag.json.expires_in : null, scope: str(ag.json.scope) } : p1Error(ag) } });
      if (!agent) {
        outcome = ag.unreachable ? 'REAL_UNREACHABLE' : 'REAL_REFUSED';
        const noGrant = !ag.unreachable && p1Error(ag).error === 'invalid_scope';
        reply = { who: 'PingOne', text: ag.unreachable ? 'PingOne did not answer the agent\'s token request. Check the network, or switch to Mock.' : noGrant ? `PingOne refused the agent's token for the scope ${config.agentScope} (invalid_scope): the agent app has no grant for it. Ask the owner to re-run scripts/owner/pingone-real-setup.mjs --apply, or set AAG_AGENT_SCOPE to the scope that was granted.` : `PingOne refused the agent's own token (HTTP ${ag.status}). Check AAG_AGENT_CLIENT_ID and its secret.` };
        notRun('token-exchange', 'Token exchange 1: act = agent', 'bff', 'pingone', 'Not run: the agent has no token.', EX1_TITLE);
        notRun('token-exchange', 'Token exchange 2: for the gateway', 'bff', 'pingone', 'Not run: the agent has no token.', EX2_TITLE);
        finishNotRun(0, 'Not run: the agent has no token.');
      } else {
        addToken('agent token (REAL, client credentials)', agent, 'REAL token for the agent app, shown raw for teaching. This is the actor token. The agent secret is write-only.');
        // 3. Exchange 1: the user's token + the agent as actor, for the agent scope. PingOne mints act from the actor token on that scope's resource.
        const t3 = tp();
        const ex1Scope = A2A ? A2A.intermediateScope : config.agentScope;
        const ex1 = await tokenCall({ grant_type: TX, subject_token: session.accessToken, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: ex1Scope, ...(A2A ? { audience: A2A.intermediateAud } : {}) }, config.agent, t3);
        const first = typeof ex1.json?.access_token === 'string' ? ex1.json.access_token : null;
        const dec1 = first ? decodeJwt(first) : null;
        const act1 = actOf(dec1?.claims);
        const answerOf = (ex, tok, act) => ({ status: ex.status, body: tok ? { access_token: ex.json.access_token, issued_token_type: str(ex.json.issued_token_type), token_type: str(ex.json.token_type), expires_in: Number.isFinite(ex.json.expires_in) ? ex.json.expires_in : null, scope: str(ex.json.scope), act_claim: actShown(act) } : p1Error(ex) });
        push({ kind: A2A ? 'a2a-exchange-1' : 'token-exchange', shortTitle: A2A ? A2A_EX1_TITLE : EX1_TITLE, label: A2A ? 'A2A exchange 1 [REAL]: act = agent 1 (RFC 8693 at PingOne, your token as subject, the agent token as actor, the specialist\'s intermediate audience)' : 'Token exchange 1 [REAL]: act = agent (RFC 8693 at PingOne, your token as subject, the agent token as actor)', from: 'bff', to: 'pingone', verdict: first && act1 ? 'ok' : 'deny', traceparent: t3, note: first ? (act1 ? 'PingOne stamped act = the agent into the token (the resource that owns the agent scope reads the actor token\'s client_id).' : (dec1 ? 'PingOne answered, but the token has NO act claim: check the act attribute of the resource that owns the agent scope.' : 'PingOne answered with a token that is not a JWT (opaque), so the lab cannot read an act claim from it and treats it as having none.')) : failText(ex1), request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: TX, subject_token: session.accessToken, subject_token_type: AT, actor_token: agent, actor_token_type: AT, scope: ex1Scope, ...(A2A ? { audience: A2A.intermediateAud } : {}) } }, response: answerOf(ex1, first ? 'exchange-1' : null, act1) });
        if (!first) {
          outcome = ex1.unreachable ? 'REAL_UNREACHABLE' : 'REAL_REFUSED';
          reply = { who: 'PingOne', text: ex1.unreachable ? 'PingOne did not answer token exchange 1. Check the network, or switch to Mock.' : `PingOne refused token exchange 1 (HTTP ${ex1.status}${p1Error(ex1).error ? `: ${p1Error(ex1).error}` : ''}). Check that the agent app has the token-exchange grant and the ${config.agentScope} scope.` };
          notRun('token-exchange', 'Token exchange 2: for the gateway', 'bff', 'pingone', 'Not run: exchange 1 gave no token.', EX2_TITLE);
          finishNotRun(0, 'Not run: there is no delegated token.');
        } else if (!act1) {
          // The final token would have no act either (exchange 2 only passes act through): stop before spending exchange 2, and never reach the gateway.
          addToken('exchange 1 token (REAL, NO act claim)', first, 'REAL token from exchange 1, but it has NO act claim, so nothing was sent on. Shown raw for teaching.', true);
          outcome = 'REAL_NO_ACT';
          reply = { who: 'PingOne', text: noActText(ex1Scope, false) };
          notRun('token-exchange', 'Token exchange 2: for the gateway', 'bff', 'pingone', 'Not run: exchange 1 carries no act claim, and exchange 2 only passes act through.', EX2_TITLE);
          finishNotRun(0, 'Not run: the delegated token carries no act claim, so the gateway was not called.');
        } else {
          addToken('exchange 1 token (REAL, act = agent)', first, 'REAL token from exchange 1: your subject, the agent in the act claim, the audience of the agent scope\'s resource. Shown raw for teaching.', true);
          if (A2A) {
            // A2A (owner, 2026-11-16; AI-DEMO2 a2aDelegationService): the specialist agent's own client-credentials token, then exchange 2 with the specialist as
            // the actor and the exchange-1 token as subject: PingOne nests the actors, act = { sub: specialist, act: { sub: agent 1 } }. UNVERIFIED on a tenant.
            const t4a = tp();
            const sp = await tokenCall({ grant_type: 'client_credentials', scope: A2A.intermediateScope }, A2A.agent2, t4a);
            const actor2 = typeof sp.json?.access_token === 'string' ? sp.json.access_token : null;
            push({ kind: 'actor-token', shortTitle: A2A_ACTOR2_TITLE, label: `Specialist token [REAL]: the specialist agent app's own client-credentials token (scope ${A2A.intermediateScope})`, from: 'agent', to: 'pingone', verdict: actor2 ? 'ok' : 'deny', traceparent: t4a, note: actor2 ? 'The specialist agent app (AAG_A2A_AGENT_CLIENT_ID) authenticated with its own secret (write-only). This is the actor token for A2A exchange 2.' : failText(sp), request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: 'client_credentials', scope: A2A.intermediateScope } }, response: { status: sp.status, body: actor2 ? { access_token: actor2, token_type: str(sp.json.token_type), expires_in: Number.isFinite(sp.json.expires_in) ? sp.json.expires_in : null, scope: str(sp.json.scope) } : p1Error(sp) } });
            if (!actor2) {
              outcome = sp.unreachable ? 'REAL_UNREACHABLE' : 'REAL_REFUSED';
              reply = { who: 'PingOne', text: sp.unreachable ? 'PingOne did not answer the specialist agent\'s token request. Check the network, or switch to Mock.' : `PingOne refused the specialist agent's token (HTTP ${sp.status}${p1Error(sp).error ? `: ${p1Error(sp).error}` : ''}). Check AAG_A2A_AGENT_CLIENT_ID and its secret, and that the specialist app holds the ${A2A.intermediateScope} grant.` };
              notRun('token-exchange', 'A2A exchange 2: nested act', 'bff', 'pingone', 'Not run: the specialist has no token.', A2A_EX2_TITLE);
              finishNotRun(0, 'Not run: the specialist has no token.');
            } else {
              addToken('specialist agent token (REAL, client credentials)', actor2, 'REAL token for the specialist agent app, shown raw for teaching. This is the actor token of A2A exchange 2. Its secret is write-only.');
              const t4 = tp();
              const ex2 = await tokenCall({ grant_type: TX, subject_token: first, subject_token_type: AT, actor_token: actor2, actor_token_type: AT, audience: A2A.gatewayAud, scope: A2A.scope }, A2A.agent2, t4);
              const delegated = typeof ex2.json?.access_token === 'string' ? ex2.json.access_token : null;
              const dClaims = delegated ? decodeJwt(delegated)?.claims ?? null : null;
              const act2 = actOf(dClaims);
              // The chain: act = the specialist and, inside it, the first agent. A flat act (one actor) is not the A2A chain.
              const nested = act2 ? actOf({ act: typeof act2.act === 'string' ? (() => { try { return JSON.parse(act2.act); } catch { return null; } })() : act2.act }) : null;
              const chainOk = Boolean(act2 && nested);
              const auds2 = [].concat(dClaims?.aud ?? []).filter((a) => typeof a === 'string');
              const aud2Note = delegated && dClaims && !auds2.includes(A2A.gatewayAud) ? ` The token's aud (${cleanFree(auds2.join(' ') || 'none', 300)}) is not AAG_A2A_GATEWAY_AUDIENCE.` : '';
              push({ kind: 'a2a-exchange-2', shortTitle: A2A_EX2_TITLE, label: 'A2A exchange 2 [REAL]: nested act (RFC 8693 at PingOne, the agent-1 token as subject, the specialist token as actor)', from: 'bff', to: 'pingone', verdict: delegated && chainOk ? 'ok' : 'deny', traceparent: t4, note: delegated ? `${chainOk ? 'PingOne nested the actors: act = the specialist, and inside it the first agent.' : (act2 ? 'The token has an act claim, but it is NOT nested (the specialist acting for the first agent): the A2A chain is missing.' : 'The token has NO act claim.')}${aud2Note}` : failText(ex2), request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: TX, subject_token: first, subject_token_type: AT, actor_token: actor2, actor_token_type: AT, audience: A2A.gatewayAud, scope: A2A.scope } }, response: answerOf(ex2, delegated ? 'a2a-delegated' : null, act2) });
              if (!delegated) {
                outcome = ex2.unreachable ? 'REAL_UNREACHABLE' : 'REAL_REFUSED';
                reply = { who: 'PingOne', text: ex2.unreachable ? 'PingOne did not answer A2A exchange 2. Check the network, or switch to Mock.' : `PingOne refused A2A exchange 2 (HTTP ${ex2.status}${p1Error(ex2).error ? `: ${p1Error(ex2).error}` : ''}). Check that the specialist app may exchange for ${A2A.scope} on ${A2A.gatewayAud}, and the may_act of the intermediate resource.` };
                finishNotRun(0, 'Not run: there is no delegated token.');
              } else if (!chainOk) {
                addToken('delegated token (REAL, A2A exchange 2, act NOT nested)', delegated, 'REAL token from A2A exchange 2, but its act claim is missing or not nested, so it was not sent to the gateway. Shown raw for teaching.', true);
                outcome = 'REAL_NO_ACT';
                reply = { who: 'PingOne', text: 'Stopped before the gateway, nothing was sent to it: the delegated token does not carry the nested act chain (the specialist acting for the first agent). Check the specialist\'s intermediate resource and its may_act.' };
                finishNotRun(0, 'Not run: the delegated token carries no nested act chain, so the gateway was not called.');
              } else {
                addToken('delegated token (REAL, A2A exchange 2: nested act)', delegated, `REAL delegated token: your subject, act = the specialist with the first agent inside it. Shown raw for teaching. Its audience is the A2A gateway audience, not AAG_GATEWAY_AUDIENCE: whether the Agent Gateway accepts it is for this run to show (UNVERIFIED).${aud2Note}`, true);
                const leg = await gatewayLeg({ token: delegated, vertical, tool, uc, tp, push, notRun, receipt, gw });
                outcome = leg.outcome; reply = leg.reply;
                if (leg.challengeId) challenge = leg.challengeId;
              }
            }
          } else {
          // 4. Exchange 2: the exchange-1 token as subject, no actor, no audience parameter; the gateway scope picks the audience and passes act through.
          const t4 = tp();
          const ex2 = await tokenCall({ grant_type: TX, subject_token: first, subject_token_type: AT, scope: config.scope }, config.agent, t4);
          const delegated = typeof ex2.json?.access_token === 'string' ? ex2.json.access_token : null;
          const dClaims = delegated ? decodeJwt(delegated)?.claims ?? null : null;
          const act2 = actOf(dClaims);
          const opaque2 = Boolean(delegated) && dClaims === null;
          const auds = [].concat(dClaims?.aud ?? []).filter((a) => typeof a === 'string');
          const audNote = delegated && dClaims && !auds.includes(config.audience) ? ` The token's aud (${cleanFree(auds.join(' ') || 'none', 300)}) is not AAG_GATEWAY_AUDIENCE: the gateway may refuse it. Check which resource owns the gateway scope.` : '';
          push({ kind: 'token-exchange', shortTitle: EX2_TITLE, label: 'Token exchange 2 [REAL]: for the gateway (RFC 8693 at PingOne, the exchange-1 token as subject, no actor, the gateway scope)', from: 'bff', to: 'pingone', verdict: delegated && act2 ? 'ok' : 'deny', traceparent: t4, note: delegated ? `${act2 ? 'act carried over from exchange 1; the audience comes from the resource that owns the gateway scope (no audience parameter is sent).' : (opaque2 ? 'The token is not a JWT (opaque), so the lab cannot read an act claim from it and treats it as having none.' : 'The token has NO act claim: exchange 2 should pass the exchange-1 token\'s act through.')}${audNote}` : failText(ex2), request: { method: 'POST', url: `${config.base}/as/token`, headers: { authorization: SECRET_SHOWN }, body: { grant_type: TX, subject_token: first, subject_token_type: AT, scope: config.scope } }, response: answerOf(ex2, delegated ? 'delegated' : null, act2) });
          if (!delegated) {
            outcome = ex2.unreachable ? 'REAL_UNREACHABLE' : 'REAL_REFUSED';
            reply = { who: 'PingOne', text: ex2.unreachable ? 'PingOne did not answer token exchange 2. Check the network, or switch to Mock.' : `PingOne refused token exchange 2 (HTTP ${ex2.status}${p1Error(ex2).error ? `: ${p1Error(ex2).error}` : ''}). Check that the agent app is granted the gateway scope and that the scope's resource exists.` };
            finishNotRun(0, 'Not run: there is no delegated token.');
          } else if (!act2) {
            addToken('delegated token (REAL, exchange 2: for the gateway, NO act claim)', delegated, 'REAL token from exchange 2, but it has NO act claim, so it was not sent to the gateway. Shown raw for teaching.', true);
            outcome = 'REAL_NO_ACT';
            reply = { who: 'PingOne', text: noActText(config.agentScope, true) };
            finishNotRun(0, 'Not run: the delegated token carries no act claim, so the gateway was not called.');
          } else {
            addToken('delegated token (REAL, exchange 2: for the gateway)', delegated, `REAL delegated token: your subject, the agent in the act claim, the gateway audience and scope. Shown raw for teaching.${audNote}`, true);
            const leg = await gatewayLeg({ token: delegated, vertical, tool, uc, tp, push, notRun, receipt, gw });
            outcome = leg.outcome; reply = leg.reply;
            if (leg.challengeId) challenge = leg.challengeId; // a REAL_HOLD with a minted challenge: the mock phone can approve it
          }
          }
        }
      }
      return {
        schema: 'appfire-agent-governance-run/1', mode: 'live', kind: 'real', useCase: { id: uc.id, track: uc.track, title: uc.title, maturity: uc.maturity, flag: uc.flag }, vertical,
        expectedOutcome: uc.expectedOutcome, real: { level: 'full', tool, ...(A2A ? { a2a: true } : {}) }, labSimulated: false, computed: false, persona: null, outcome, matchesExpected: null, reply,
        hops: hops.map(({ shortTitle, ...h }) => { const e0 = enrichHop(h, HOP_CATALOG, h.decision ? { decision: h.decision } : undefined, { tokens: 'raw' }); const e = e0.verdict === 'error' ? { ...e0, fact: 'no decision' } : e0; return shortTitle ? { ...e, title: shortTitle } : e; }), gatewayTrace: gw, tokens, traceId: trace.traceId, traceparent: formatTraceparent(trace.traceId, rootSpan),
        narration: reply?.text ?? '',
        ...(outcome === 'REAL_HOLD' && challenge ? { challenge } : {}),
      };
    } finally { inFlight -= 1; }
  }

  // 4-8: the Agent Gateway as an MCP client, the decision read from its answer, the tool, the API behind it and the reply.
  async function gatewayLeg({ token, vertical, tool, uc, tp, push, notRun, receipt = null, gw = [] }) {
    const gs = createGatewaySession({ url: config.gatewayUrl, token, vertical, nextTraceparent: tp, fetchImpl: gatewayFetch ?? fetchImpl });
    const shownReq = (c, body) => ({ method: 'POST', url: config.gatewayUrl, headers: Object.fromEntries(c.sentHeaders.map((k) => [k, k === 'authorization' ? `Bearer ${token}` : k === 'traceparent' ? c.traceparent : k === 'x-active-vertical' ? vertical : k === 'x-token-validation' ? 'jwks' : k === 'mcp-session-id' ? gs.sessionId() : k === 'mcp-protocol-version' ? '(from initialize)' : k === 'accept' ? 'application/json, text/event-stream' : 'application/json'])), body });
    const shownRes = (c, body) => ({ status: c.status, headers: Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, v])), body });
    const rest = (from, why) => {
      const all = [['authorize-decision', 'Authorize decision', 'gateway', 'authorize'], ['tool-dispatched', 'MCP tool', 'gateway', 'mcp'], ['api-call', 'API', 'mcp', 'api'], ['agent-reply', 'Agent reply', 'agent', 'page']];
      for (const [kind, label, f, t] of all.slice(from)) notRun(kind, label, f, t, why);
    };
    const mapped = (c) => mapAnswer(c);
    // One trace record per call the gateway answered (or failed to): the request and answer as they were, the decisions read from the status.
    const traced = (c, title, setup) => gw.push(realExchange(c, { step: gw.length + 1, title, url: config.gatewayUrl, token, vertical, setup, receipt }));
    const init = await gs.initialize();
    let list = null;
    if (init.kind === 'ok') {
      const inited = await gs.initialized();
      list = await gs.listTools();
      traced(list, 'tools/list', [{ label: 'initialize', status: init.status || null }, { label: 'notifications/initialized', status: inited.status || null }]);
    } else traced(init, 'initialize');
    const listed = Array.isArray(list?.rpc?.result?.tools) ? list.rpc.result.tools.filter((t) => t && typeof t.name === 'string').map((t) => t.name.slice(0, 80)).slice(0, 300) : [];
    const firstBad = init.kind !== 'ok' ? init : list && list.kind !== 'ok' ? list : null;
    push({
      kind: 'gateway-check', label: 'Agent Gateway [REAL]: initialize and tools/list over MCP with the delegated token', from: 'agent', to: 'gateway', verdict: firstBad ? (firstBad.kind === 'hold' ? 'held' : 'deny') : 'ok', traceparent: init.traceparent,
      note: firstBad ? mapped(firstBad).note : `The gateway accepted the delegated token (X-Token-Validation: jwks) and listed ${listed.length} tools${listed.includes(tool) ? `, including ${tool}` : `; ${tool} is NOT among them`}. No trusted-caller header was sent.`,
      request: { calls: [shownReq(init, { method: 'initialize' }), ...(list ? [shownReq(list, { method: 'notifications/initialized, then tools/list' })] : [])] },
      response: { calls: [shownRes(init, init.rpc?.result ? { serverInfo: init.rpc.result.serverInfo ?? null, protocolVersion: str(init.rpc.result.protocolVersion) } : init.rpc?.error ?? null), ...(list ? [shownRes(list, { tools: listed.length, names: listed.slice(0, 40) })] : [])] },
    });
    if (firstBad) { const m = mapped(firstBad); rest(0, `Not run: ${m.note}`); return { outcome: m.outcome, reply: m.reply }; }
    if (!listed.includes(tool)) {
      // UC21 (entitlement tiers): the product never offers a premium tool to a standard-tier user, so "not listed" IS the standard tier (owner 2026-11-16).
      if (uc.id === 'UC21') {
        rest(0, `Not run: the gateway does not offer ${tool} to this user. For the entitlement-tier use case that is the standard tier: the tier (a PingOne group) decides which tools exist.`);
        return { outcome: 'REAL_NOT_LISTED', reply: { who: 'Gateway', text: `The Agent Gateway does not offer the tool ${tool} to this user, so the agent never called it. For the entitlement-tier use case that is what a standard tier looks like: the tier, a PingOne group, decides which tools exist. Add your user to the premium-tier group in PingOne, sign out, sign in again and run it again to see it offered.` } };
      }
      rest(0, `Not run: the gateway does not list ${tool}. Switch to Mock to see this use case.`);
      return { outcome: 'REAL_NOT_LISTED', reply: { who: 'Gateway', text: `The Agent Gateway does not list the tool ${tool} for this token, so the agent did not call it. Switch to Mock to see this use case.` } };
    }
    // The user's own account ids, when the tool needs them (lab rule: the first two accounts).
    const calls = [];
    let accounts = [];
    if (NEEDS_ACCOUNTS.has(tool)) {
      const acc = await gs.callTool('get_my_accounts', {});
      calls.push(acc);
      traced(acc, 'tools/call get_my_accounts');
      if (acc.kind === 'ok') accounts = accountIds(toolPayload(acc.rpc?.result));
    }
    const pre = calls.find((c) => c.kind !== 'ok');
    const needTwo = tool === 'create_transfer';
    if (!pre && NEEDS_ACCOUNTS.has(tool) && accounts.length < (needTwo ? 2 : 1)) {
      notRun('authorize-decision', 'Authorize decision', 'gateway', 'authorize', `Not run: ${tool} was not called.`);
      push({ kind: 'tool-refused', label: `MCP tool [REAL]: get_my_accounts (${tool} was not called)`, from: 'gateway', to: 'mcp', verdict: 'deny', traceparent: calls[0].traceparent, note: `The account list had ${accounts.length} usable account${accounts.length === 1 ? '' : 's'}; ${tool} needs ${needTwo ? 'two' : 'one'}, so the lab did not call it.`, request: { calls: calls.map((c) => shownReq(c, { method: 'tools/call', name: 'get_my_accounts', arguments: {} })) }, response: { calls: calls.map((c) => shownRes(c, { content: contentShown(c.rpc?.result) })) } });
      rest(2, 'Not run: the tool was not called.');
      return { outcome: 'REAL_TOOL_ERROR', reply: { who: 'Agent', text: `I could not find ${needTwo ? 'two accounts' : 'an account'} of yours for ${tool}, so I did not call it.` } };
    }
    const args = toolArgs(tool, { vertical, accounts, amount: situationOf(uc.id).amount, args: situationOf(uc.id).args });
    // Owner 2026-11-13: a HITL retry echoes the gateway's challenge id as the control field _hitl_challenge_id
    // (the gateway strips it before dispatch; a verified receipt discharges the consent obligation).
    if (receipt) args._hitl_challenge_id = receipt;
    const call = pre ? null : await gs.callTool(tool, args);
    if (call) { calls.push(call); traced(call, `tools/call ${tool}`); }
    const last = call ?? pre;
    const m = mapped(last);
    const audit = parseAuditTrail(last.headers['x-gw-audit-trail']);
    const decisionOutcome = last.kind === 'deny' ? 'DENY' : last.kind === 'hold' ? 'HOLD' : last.kind === 'ok' ? 'PERMIT' : last.kind === 'token' ? 'TOKEN REFUSED' : 'NO DECISION';
    push({
      kind: 'authorize-decision', label: `Authorize decision [REAL]: ${decisionOutcome}, read from the gateway's answer to tools/call`, from: 'gateway', to: 'authorize', verdict: last.kind === 'ok' ? 'ok' : last.kind === 'hold' ? 'held' : (last.kind === 'unreachable' || last.kind === 'other') ? 'error' : 'deny', traceparent: last.traceparent,
      decision: { outcome: audit?.decision ?? decisionOutcome, by: 'the Agent Gateway (REAL)' },
      note: last.kind === 'ok' ? 'The gateway let tools/call through, so its policy permitted it.' : m.note, request: { tool, arguments: argsShown(args) }, response: { status: last.status, ...(audit ? { 'x-gw-audit-trail': audit.parsed ?? audit.raw, decision: audit.decision } : {}), ...(last.headers['www-authenticate'] ? { 'www-authenticate': last.headers['www-authenticate'] } : {}), ...(last.rawText ? { body: last.rawText } : {}), ...(last.status === 0 ? { no_response: last.timedOut ? `no HTTP response within ${Math.round((last.waitedMs ?? 0) / 1000)} s: the lab stopped waiting` : 'the connection failed before any response' } : {}) },
    });
    const result = last.kind === 'ok' ? last.rpc?.result ?? null : null;
    const rpcError = last.kind === 'ok' ? last.rpc?.error ?? null : null;
    const toolFailed = last.kind === 'ok' && (!result || result.isError === true || rpcError);
    const cut = last.kind === 'ok' && !result && last.truncated;
    push({
      kind: last.kind === 'ok' ? 'tool-dispatched' : last.kind === 'hold' ? 'tool-held' : 'tool-refused', label: `MCP tool [REAL]: tools/call ${tool}${calls.length > 1 ? ' (after get_my_accounts for your account ids)' : ''}`, from: 'gateway', to: 'mcp', verdict: last.kind === 'ok' && !toolFailed ? 'ok' : last.kind === 'hold' ? 'held' : (last.kind === 'unreachable' || last.kind === 'other') ? 'error' : 'deny', traceparent: last.traceparent,
      note: last.kind === 'ok' ? (toolFailed ? 'The tool answered with an error.' : 'The SE MCP server ran the tool.') : m.note,
      request: { calls: calls.map((c) => shownReq(c, { method: 'tools/call', name: c === call ? tool : 'get_my_accounts', arguments: c === call ? argsShown(args) : {} })) },
      response: { calls: calls.map((c) => shownRes(c, c.kind !== 'ok' ? (c.rawText ? { raw: c.rawText } : null) : c.rpc ? (c.rpc.error ? { error: { code: c.rpc.error.code ?? null, message: str(c.rpc.error.message) } } : { isError: c.rpc.result?.isError === true, content: contentShown(c.rpc.result) }) : null)) },
    });
    if (last.kind !== 'ok') { rest(2, `Not run: ${m.note}`); return { outcome: m.outcome, reply: m.reply }; }
    if (toolFailed) {
      notRun('api-call', 'API', 'mcp', 'api', 'Not known: the tool answered with an error.');
      const why = rpcError ? str(rpcError.message) : textOf(result);
      const text = cut ? `The answer from ${tool} was larger than the lab reads, so it was cut off and not used.` : `The tool ${tool} answered with an error${why ? `: ${cleanFree(why, 300)}` : ''}.`;
      push({ kind: 'agent-reply', label: 'Agent reply [REAL]: written from the tool\'s error', from: 'agent', to: 'page', verdict: 'ok', traceparent: tp(), request: {}, response: { reply: text } });
      return { outcome: 'REAL_TOOL_ERROR', reply: { who: 'Agent', text } };
    }
    push({ kind: 'api-call', label: 'API [REAL]: the call behind the tool, made by the SE MCP server (seen only through its result)', from: 'mcp', to: 'api', verdict: 'ok', traceparent: last.traceparent, note: 'The lab does not see this call itself: the MCP server makes it with its own token and hands back the result.', request: { note: 'made by the SE MCP server, not by this lab' }, response: { content: contentShown(result) } });
    const text = replyText(tool, result);
    push({ kind: 'agent-reply', label: 'Agent reply [REAL]: written from the real tool result', from: 'agent', to: 'page', verdict: 'ok', traceparent: tp(), request: {}, response: { reply: text } });
    return { outcome: 'REAL_PERMIT', reply: { who: 'Agent', text } };
  }

  return {
    configured, wanted: () => wanted, problem: () => (configured() ? null : config.problem), missing: () => [...missing],
    username: () => (configured() ? config.username : null),
    origins: () => (configured() ? [new URL(config.base).origin, new URL(config.gatewayUrl).origin] : []),
    hosts: () => (configured() ? [new URL(config.base).hostname, new URL(config.gatewayUrl).hostname] : []),
    a2aReady: () => configured() && Boolean(config.a2a), a2aProblem: () => (configured() ? config.a2aProblem ?? null : null),
    signIn, session: sessionOf, signOut: (ws) => sessions.delete(ws), userOf, run,
    // A workspace's session, or one signed in silently from the PingOne session (null when there is none or it has ended). Waits 5 s after a failed try.
    ensureSession,
    // Forget the PingOne session: an explicit Sign out. (Reset ends only the workspace's token session, so the next run signs in silently.)
    forgetP1: () => { sso = null; }, hasP1Session: () => Boolean(sso),
  };
}

// The gateway's answer to the lab's words: outcome, the hop note and the reply. 403 DENY (with the audit trail's decision), 401 token problem (with
// WWW-Authenticate), 428 hold (REAL hold, simulated approval), 502/503/504 or no answer: SE is down or scaled down. Never retried.
export function mapAnswer(c) {
  const audit = parseAuditTrail(c.headers?.['x-gw-audit-trail']);
  const www = c.headers?.['www-authenticate'] ? str(c.headers['www-authenticate'], 500) : null;
  switch (c.kind) {
    case 'deny': return { outcome: 'REAL_DENY', note: `The gateway answered 403: a policy DENY${audit?.decision ? ` (audit trail decision: ${audit.decision})` : ''}.`, reply: { who: 'Authorize', text: `Authorize denied this request (HTTP 403 from the Agent Gateway${audit?.decision ? `, decision ${audit.decision}` : ''}). Nothing was sent to the tool.` } };
    case 'token': return { outcome: 'REAL_TOKEN_PROBLEM', note: `The gateway answered 401: a token problem${www ? ` (WWW-Authenticate: ${www})` : ''}.`, reply: { who: 'Gateway', text: `The Agent Gateway did not accept the delegated token (HTTP 401)${www ? `: ${www}` : ''}. Check the token exchange audience and scope.` } };
    case 'hold': {
      const body = c.rpc?.error ?? c.body ?? null;
      const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : null;
      const isStepUp = body?.error === 'step_up_required';
      return {
        outcome: 'REAL_HOLD',
        ...(challengeId && !isStepUp ? { challengeId } : {}),
        note: isStepUp
          ? 'The gateway answered 428: step-up (a stronger authentication) is required. The hold is REAL; the second factor is simulated in this lab and cannot discharge a real step-up, so the call is not retried.'
          : `The gateway answered 428: a person must approve (challenge ${challengeId ? 'minted' : 'not minted'}). The hold is REAL; approve on the mock phone and the lab retries with the receipt.`,
        reply: {
          who: 'Authorize',
          approval: {
            head: isStepUp ? 'Held for step-up (REAL)' : 'Held for approval (REAL)',
            body: isStepUp
              ? 'The real Agent Gateway answered 428: this call needs step-up authentication. The hold is real; this lab simulates the second factor and cannot discharge a real step-up, so nothing was sent to the tool.'
              : 'The real Agent Gateway answered 428: this call needs a person to approve it. The hold is real; approve (or deny) on the mock phone — an approval is recorded with the HITL service and the call is retried with the verified receipt.',
          },
        },
      };
    }
    case 'unreachable': {
      // Three different things, said apart (owner 2026-11-16: "no response" is not a malformed request, which would get a 4xx): the gateway answered 5xx, it sent nothing in time, or the connection failed.
      const what = c.status ? `answered HTTP ${c.status} and did not complete the call` : c.timedOut ? `sent no HTTP response within ${Math.round((c.waitedMs ?? 0) / 1000)} s, so the lab stopped waiting` : 'could not be reached: the connection failed before any response';
      const why = c.status ? 'It may be down or scaled down, or unable to get a decision from Authorize; its own answer is shown in the hop.' : c.timedOut ? 'A timeout is not an error answer: the gateway may be down, or still waiting on Authorize.' : 'Check the gateway URL and the network.';
      return { outcome: 'REAL_UNREACHABLE', note: `The Agent Gateway ${what}. ${why} The lab does not retry. Switch to Mock to keep going.`, reply: { who: 'Gateway', text: `No decision: the Agent Gateway ${what}. ${why} Switch to Mock to keep going.` } };
    }
    default: return { outcome: 'REAL_REFUSED', note: `The gateway answered HTTP ${c.status}${c.status >= 300 && c.status < 400 ? ' (a redirect, never followed)' : ''}.`, reply: { who: 'Gateway', text: `The Agent Gateway answered HTTP ${c.status}; the agent stopped there.` } };
  }
}

// What a tool returned: structuredContent, else the JSON in its first text block, else the text.
export function toolPayload(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const t = textOf(result);
  if (t) { try { return JSON.parse(t); } catch { return t; } }
  return null;
}
const textOf = (result) => (Array.isArray(result?.content) ? result.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n').slice(0, 4000) : '');
const contentShown = (result) => { const p = toolPayload(result); return typeof p === 'string' ? cleanFree(p, 2000) : p; };
const argsShown = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, /account_id$/.test(k) && typeof v === 'string' ? `${v.slice(0, 4)}...` : v]));
export function accountIds(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.accounts) ? payload.accounts : [];
  return list.map((a) => (a && typeof a.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(a.id) ? a.id : null)).filter(Boolean).slice(0, 2);
}
// The reply in the Agent's voice, from the real result: up to six plain fields, or the first sentence of text. Never more than 600 characters.
export function replyText(tool, result) {
  const p = toolPayload(result);
  if (typeof p === 'string') return cleanFree(`Here is what ${tool} returned: ${p}`, 600);
  const flat = (o) => Object.entries(o || {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
  if (Array.isArray(p)) return cleanFree(`${tool} returned ${p.length} ${p.length === 1 ? 'item' : 'items'}${p.length && typeof p[0] === 'object' ? `; the first: ${flat(p[0])}` : ''}.`, 600);
  if (p && typeof p === 'object') {
    const arr = Object.entries(p).find(([, v]) => Array.isArray(v));
    const head = flat(p);
    return cleanFree(`Here is what ${tool} returned: ${head || (arr ? `${arr[1].length} ${arr[0]}` : 'an empty answer')}${head && arr ? ` (and ${arr[1].length} ${arr[0]})` : ''}.`, 600);
  }
  return `${tool} answered with no content.`;
}
