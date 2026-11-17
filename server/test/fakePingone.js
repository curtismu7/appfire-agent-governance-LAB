// A fake PingOne on a loopback port, for the live-mode tests and the e2e. It is not PingOne: it answers the paths live mode and full Real call and records
// what it was sent. The client ids and secrets and the demo password are assembled at run time, so no credential-shaped string sits in the repository.
// Full Real (owner, 2026-11-10): authorize with response_mode=pi.flow (anything else is refused: there is no redirect login), the flows API
// username/password step, resume, and the token endpoint for authorization_code (PKCE S256 checked), client_credentials and RFC 8693 token exchange.
// It models the two PingOne resources the two-exchange pattern needs (state.resources), as the real setup has them:
//   agent   owns the agent scope; its act attribute reads the ACTOR token's client_id into act.sub (act: 'actor'), or is missing (act: 'absent').
//   gateway owns the gateway scope and chooses the audience; its act attribute passes the SUBJECT token's act through (act: 'passthrough'), or is missing.
// So exchange 1 (user + agent actor, agent scope) mints act, exchange 2 (the exchange-1 token, gateway scope) keeps it, and the OLD single exchange (the
// user's token + the agent actor + the gateway scope) or an exchange 2 on a plain user token mints NO act: the bug this fake lets the tests pin.
// (act: 'empty' mints a useless act: {} with no sub; 'blank' an act with an empty sub.)
// A third resource, the tools resource (2026-11-16, the owner's "Appfire Work Suite Tools": audience appfire-work-tools, six scopes, act passed through, a
// groups claim from state.tools.groups): exchange 2 for ONE tool scope mints for it. Every token is signed ES256 with a fixed public test key (kid fake-es-1),
// its iss is this fake's own base (http://127.0.0.1:<port>/<env>/as) and discovery and /as/jwks serve it, so the lab's tool server can verify it for real.
// state.full picks a variant: { signin: 'ok' | 'resume' | 'bad-password' | 'mfa' | 'echo-pw' | 'bad-state' | 'no-state',
//   exchange: 'ok' | 'refuse-tools' (the exchange for a tool scope) | 'opaque-tools' (that exchange answers an opaque token) | 'refuse' (the exchange for the agent scope) | 'refuse-2' (the exchange for the gateway scope) | 'echo' / 'echo-2' (the same refusals, but
//   PingOne's error text echoes the subject token and the agent's client secret, as a careless authorization server might) }.
import http from 'node:http';
import { createECDH, createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';

export const ENV_ID = '11111111-2222-4333-8444-555555555555';
export const CLIENT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
export const CLIENT_SECRET = ['fake', '-client-', 'secret-', 'for-tests-', '0123456789abcdef'].join('');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// A JWT-shaped token built here; the signature segment is filler.
export const FAKE_TOKEN = [b64u({ alg: 'RS256', typ: 'JWT', kid: 'fake-kid' }), b64u({ iss: `http://fake.invalid/${ENV_ID}/as`, aud: 'https://api.fake.invalid', client_id: CLIENT_ID, scope: 'p1:fake', exp: 4102444800 }), 'ZmFrZXNpZ25hdHVyZWZvcnRlc3Rz'].join('.');

export const USER_CLIENT_ID = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
export const USER_CLIENT_SECRET = ['fake', '-user-', 'secret-', 'for-tests-', 'fedcba9876543210'].join('');
export const AGENT_CLIENT_ID = '88888888-9999-4aaa-8bbb-cccccccccccc';
export const AGENT_CLIENT_SECRET = ['fake', '-agent-', 'secret-', 'for-tests-', '13579bdf02468ace'].join('');
export const DEMO_USERNAME = 'lab-demo-user';
export const DEMO_PASSWORD = ['Fake', 'Pass', 'word-', 'for-tests-', '42'].join('');
export const AUDIENCE = 'fake-gateway-audience';
export const SCOPE = 'fake:mcp:invoke';
export const AGENT_SCOPE = 'agent:invoke';
export const AGENT_AUDIENCE = 'fake-agent-audience';
// Real A2A (owner, 2026-11-16): the specialist agent app and the two resources of the chained exchange, as AI-DEMO2's a2aDelegationService uses them.
// state.a2a picks a variant: { specialist: 'ok' | 'bad-secret', exchange1: 'ok' | 'refuse', exchange2: 'ok' | 'refuse' | 'flat' (one actor, not nested) | 'none' (no act) }.
export const SPECIALIST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const SPECIALIST_SECRET = ['fake', '-specialist-', 'secret-', 'for-tests-', '2468ace013579bdf'].join('');
export const A2A_INTERMEDIATE_AUD = 'fake-a2a-intermediate-audience';
export const A2A_INTERMEDIATE_SCOPE = 'agent:invoke:investment';
export const A2A_GATEWAY_AUD = 'fake-a2a-gateway-audience';
export const A2A_SCOPE = 'invest:read';
export const a2aSettings = (extra = {}) => ({
  AAG_A2A_AGENT_CLIENT_ID: SPECIALIST_ID, AAG_A2A_AGENT_CLIENT_SECRET: SPECIALIST_SECRET, AAG_A2A_AGENT_TOKEN_AUTH: 'CLIENT_SECRET_POST', AAG_A2A_INTERMEDIATE_AUDIENCE: A2A_INTERMEDIATE_AUD,
  AAG_A2A_INTERMEDIATE_SCOPE: A2A_INTERMEDIATE_SCOPE, AAG_A2A_GATEWAY_AUDIENCE: A2A_GATEWAY_AUD, AAG_A2A_SCOPE: A2A_SCOPE, ...extra,
});
export const USER_SUB = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
// The tools resource of the owner's PingOne (names only): the six scopes, the audience and the premium-tier group.
export const TOOLS_AUDIENCE = 'appfire-work-tools';
export const TOOLS_SCOPES = ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request'];
export const TIER_GROUP = 'Software_EnterpriseTier';
// A fixed public test key (the scalar protects nothing), built with createECDH + createPrivateKey like mockjwt.js.
const ES_SCALAR = createHash('sha256').update('appfire fake pingone es256 test key (public, protects nothing)').digest();
const ES_KEYS = (() => {
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(ES_SCALAR);
  const pub = ecdh.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') };
  return { privateKey: createPrivateKey({ key: { ...jwk, d: ES_SCALAR.toString('base64url') }, format: 'jwk' }), publicJwk: { ...jwk, kid: 'fake-es-1', use: 'sig', alg: 'ES256' } };
})();
export const FAKE_PUBLIC_JWK = ES_KEYS.publicJwk;
// A signed ES256 token. issuer: the base the fake serves (set once it listens).
const signJwt = (issuer, claims) => {
  const input = `${b64u({ alg: 'ES256', typ: 'JWT', kid: 'fake-es-1' })}.${b64u({ iss: issuer, iat: 1700000000, exp: 4102444800, ...claims })}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: ES_KEYS.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};
const basicOf = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const claimsIn = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } };
const AT_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

// behaviour: 'ok' | 'bad-secret' | 'discovery-500' | 'redirect' | 'huge' | 'slow' | 'html' | 'opaque'
export async function startFakePingOne({ behaviour = 'ok', delayMs = 0, agentScope = AGENT_SCOPE } = {}) {
  const seen = [];
  let issuer = `http://fake.invalid/${ENV_ID}/as`; // the real one once the fake listens
  const jwt = (claims) => signJwt(issuer, claims);
  const resources = {
    agent: { name: 'Fake agent resource', audience: AGENT_AUDIENCE, scopes: [agentScope], act: 'actor' },
    gateway: { name: 'Fake gateway resource', audience: AUDIENCE, scopes: [SCOPE], act: 'passthrough' },
    tools: { name: 'Fake tools resource', audience: TOOLS_AUDIENCE, scopes: TOOLS_SCOPES, act: 'passthrough', groups: true },
  };
  // agentGrants: the scopes the agent app may ask for (the owner setup script grants them all).
  // tools.groups: what the tools resource's groups attribute puts in an exchanged token (settable per test; [] = a standard-tier user, null = no groups claim at all).
  const state = { behaviour, delayMs, sso: { mode: 'ok' }, full: { signin: 'ok', exchange: 'ok' }, a2a: { specialist: 'ok', exchange1: 'ok', exchange2: 'ok' }, resources, agentGrants: [agentScope, SCOPE, ...TOOLS_SCOPES], tools: { groups: [] } };
  const flows = new Map(); // flow id -> { cookie, challenge, state, nonce, done }
  // The PingOne session (owner, 2026-11-16): a completed password sign-in sets the P1SSO cookie; authorize with a valid one answers COMPLETED with a code and no
  // password step. state.sso.mode: 'ok' | 'expired' (the cookie is no longer honoured: the password is asked for again).
  const ssoValid = new Set();
  const codes = new Map(); // code -> { challenge, nonce }
  // exchange1: tokens minted for the agent scope's resource. delegated: tokens for the gateway scope's resource that carry act (what the gateway and
  // Authorize accept). noAct: gateway-resource tokens WITHOUT act (the old single-exchange bug): the fake gateway refuses these.
  const issued = { user: new Set(), agent: new Set(), exchange1: new Set(), delegated: new Set(), noAct: new Set(), a2a1: new Set(), agent2: new Set() };
  const resourceOf = (scope) => { const asked = String(scope || '').split(' ').filter(Boolean); return asked.length && asked.every((sc) => Object.values(resources).some((r) => r.scopes.includes(sc))) ? Object.values(resources).find((r) => r.scopes.includes(asked[0])) : null; };
  // A2A: the specialist's client-credentials token, A2A exchange 1 (the agent client, the intermediate audience) and A2A exchange 2 (the specialist as actor
  // and exchanger, the A2A gateway audience, a NESTED act). Returns [status, body] for a request that is part of the chain, or null for every other request.
  const A2A_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
  const sentBasic = (auth) => { const m = /^Basic (.+)$/.exec(String(auth || '')); return m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; };
  const a2aToken = (form, auth) => {
    const cfg = state.a2a;
    const isSpecialist = form.client_id === SPECIALIST_ID || sentBasic(auth).startsWith(`${SPECIALIST_ID}:`);
    const specialistOk = cfg.specialist !== 'bad-secret' && (auth === basicOf(SPECIALIST_ID, SPECIALIST_SECRET) || (form.client_id === SPECIALIST_ID && form.client_secret === SPECIALIST_SECRET));
    const agentOk = auth === basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET) || (form.client_id === AGENT_CLIENT_ID && form.client_secret === AGENT_CLIENT_SECRET);
    if (form.grant_type === 'client_credentials' && isSpecialist) {
      if (!specialistOk) return [401, { error: 'invalid_client', error_description: 'fake: specialist client' }];
      if (form.scope !== A2A_INTERMEDIATE_SCOPE) return [400, { error: 'invalid_scope', error_description: 'fake: the specialist app has no grant for that scope' }];
      const at = jwt({ sub: SPECIALIST_ID, client_id: SPECIALIST_ID, aud: A2A_INTERMEDIATE_AUD, scope: form.scope }); issued.agent2.add(at);
      return [200, { access_token: at, token_type: 'Bearer', expires_in: 3600, scope: form.scope }];
    }
    if (form.grant_type !== A2A_GRANT) return null;
    if (form.audience === A2A_INTERMEDIATE_AUD) { // A2A exchange 1
      if (!agentOk) return [401, { error: 'invalid_client', error_description: 'fake: agent client' }];
      if (cfg.exchange1 === 'refuse') return [400, { error: 'invalid_request', error_description: 'fake: A2A exchange 1 refused' }];
      if (form.scope !== A2A_INTERMEDIATE_SCOPE) return [400, { error: 'invalid_scope', error_description: 'fake: not the intermediate scope' }];
      if (!issued.user.has(form.subject_token) || !issued.agent.has(form.actor_token) || form.subject_token_type !== AT_TYPE || form.actor_token_type !== AT_TYPE) return [400, { error: 'invalid_grant', error_description: 'fake: the subject or actor token is not one this fake issued' }];
      const subject = claimsIn(form.subject_token); const actor = claimsIn(form.actor_token);
      const at = jwt({ sub: subject.sub, aud: A2A_INTERMEDIATE_AUD, scope: form.scope, client_id: AGENT_CLIENT_ID, act: { sub: actor.client_id } }); issued.a2a1.add(at);
      return [200, { access_token: at, issued_token_type: AT_TYPE, token_type: 'Bearer', expires_in: 900, scope: form.scope }];
    }
    if (form.audience === A2A_GATEWAY_AUD) { // A2A exchange 2
      if (!isSpecialist || !specialistOk) return [401, { error: 'invalid_client', error_description: 'fake: the exchanger must be the specialist client' }];
      if (cfg.exchange2 === 'refuse') return [400, { error: 'invalid_request', error_description: 'fake: A2A exchange 2 refused' }];
      if (form.scope !== A2A_SCOPE) return [400, { error: 'invalid_scope', error_description: 'fake: not the A2A scope' }];
      if (!issued.a2a1.has(form.subject_token) || !issued.agent2.has(form.actor_token)) return [400, { error: 'invalid_grant', error_description: 'fake: the subject is not an A2A exchange-1 token, or the actor is not the specialist\'s' }];
      const subject = claimsIn(form.subject_token); const actor = claimsIn(form.actor_token);
      const act = cfg.exchange2 === 'none' ? null : cfg.exchange2 === 'flat' ? { sub: actor.client_id } : { sub: actor.client_id, act: subject.act };
      const at = jwt({ sub: subject.sub, aud: A2A_GATEWAY_AUD, scope: form.scope, client_id: SPECIALIST_ID, ...(act ? { act } : {}) }); issued.delegated.add(at);
      return [200, { access_token: at, issued_token_type: AT_TYPE, token_type: 'Bearer', expires_in: 900, scope: form.scope }];
    }
    return null;
  };
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(body).toString('utf8') });
      const send = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      const go = () => {
        const b = state.behaviour;
        if (b === 'redirect') return send(302, '', { location: 'http://127.0.0.1:1/never-followed' });
        if (b === 'huge') return send(200, JSON.stringify({ filler: 'x'.repeat(200 * 1024) }));
        if (b === 'html') return send(200, '<html>not json</html>', { 'content-type': 'text/html' });
        const u = new URL(req.url, 'http://fake.invalid');
        const cookieOf = () => /(?:^|;\s*)ST=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] ?? null;
        if (req.method === 'GET' && u.pathname === `/${ENV_ID}/as/authorize`) {
          const q = Object.fromEntries(u.searchParams);
          if (q.response_mode !== 'pi.flow') return send(400, { error: 'unsupported_response_mode', error_description: 'fake: only pi.flow (no redirect login)' });
          if (q.client_id !== USER_CLIENT_ID || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.redirect_uri || !String(q.scope || '').split(' ').includes('openid') || !String(q.scope || '').split(' ').includes(agentScope)) return send(400, { error: 'invalid_request', error_description: 'fake: authorize needs the user client, code, PKCE S256, a redirect_uri and the openid and agent scopes' });
          const ssoCookie = /(?:^|;\s*)P1SSO=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1];
          if (ssoCookie && ssoValid.has(ssoCookie) && state.sso.mode === 'ok') {
            const code = randomBytes(16).toString('hex'); codes.set(code, { challenge: q.code_challenge, nonce: q.nonce });
            return send(200, { id: randomBytes(8).toString('hex'), status: 'COMPLETED', authorizeResponse: { code, state: q.state } });
          }
          const id = randomBytes(8).toString('hex'); const st = randomBytes(12).toString('hex');
          flows.set(id, { cookie: st, challenge: q.code_challenge, state: q.state, nonce: q.nonce, done: false });
          return send(200, { id, status: 'USERNAME_PASSWORD_REQUIRED', _links: { 'usernamePassword.check': { href: `http://fake.invalid/${ENV_ID}/flows/${id}` } } }, { 'set-cookie': [`ST=${st}; Path=/; HttpOnly`, 'interactionId=fake-interaction; Path=/'] });
        }
        const fm = /^\/[^/]+\/flows\/([a-z0-9]+)$/.exec(u.pathname);
        if (req.method === 'POST' && fm) {
          const f = flows.get(fm[1]);
          if (!f || cookieOf() !== f.cookie) return send(401, { code: 'UNAUTHORIZED', message: 'fake: the flow cookie is missing' });
          if (req.headers['content-type'] !== 'application/vnd.pingidentity.usernamePassword.check+json') return send(415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'fake: use the vendor content type' });
          let b = {}; try { b = JSON.parse(Buffer.concat(body).toString('utf8')); } catch { /* bad */ }
          if (state.full.signin === 'echo-pw') return send(400, { code: 'INVALID_DATA', message: `fake echo: ${b.password}`, details: [{ code: 'INVALID_VALUE', message: `bad ${b.password}` }] });
          if (state.full.signin === 'bad-password' || b.username !== DEMO_USERNAME || b.password !== DEMO_PASSWORD) return send(400, { code: 'INVALID_DATA', message: 'fake: the request could not be completed', details: [{ code: 'INVALID_VALUE', target: 'password', message: 'Invalid username or password' }] });
          if (state.full.signin === 'mfa') return send(200, { id: fm[1], status: 'MFA_REQUIRED' });
          f.done = true;
          const code = randomBytes(16).toString('hex'); codes.set(code, { challenge: f.challenge, nonce: f.nonce });
          if (state.full.signin === 'resume') { f.code = code; return send(200, { id: fm[1], status: 'COMPLETED', _links: { resume: { href: 'x' } } }); }
          if (state.full.signin === 'bad-state') return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code, state: 'not-the-state' } });
          if (state.full.signin === 'no-state') return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code } });
          const sso = randomBytes(12).toString('hex'); ssoValid.add(sso);
          return send(200, { id: fm[1], status: 'COMPLETED', authorizeResponse: { code, state: f.state } }, { 'set-cookie': [`P1SSO=${sso}; Path=/; HttpOnly`] });
        }
        if (req.method === 'GET' && u.pathname === `/${ENV_ID}/as/resume`) {
          const f = flows.get(u.searchParams.get('flowId'));
          if (!f || !f.done || !f.code || cookieOf() !== f.cookie) return send(400, { code: 'INVALID_REQUEST', message: 'fake: no completed flow' });
          return send(200, { authorizeResponse: { code: f.code, state: f.state } });
        }
        if (req.method === 'POST' && u.pathname === `/${ENV_ID}/as/token` && req.headers.authorization !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) {
          const form = Object.fromEntries(new URLSearchParams(Buffer.concat(body).toString('utf8')));
          const auth = req.headers.authorization;
          const a2aAnswer = a2aToken(form, auth);
          if (a2aAnswer) return send(a2aAnswer[0], a2aAnswer[1]);
          if (form.grant_type === 'authorization_code') {
            if (auth !== basicOf(USER_CLIENT_ID, USER_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: user client' });
            const c = codes.get(form.code); codes.delete(form.code);
            if (!c || createHash('sha256').update(String(form.code_verifier || '')).digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant', error_description: 'fake: bad code or PKCE verifier' });
            const at = jwt({ sub: USER_SUB, aud: AGENT_AUDIENCE, client_id: USER_CLIENT_ID, scope: `openid profile ${agentScope}`, may_act: { sub: AGENT_CLIENT_ID } }); issued.user.add(at);
            return send(200, { access_token: at, id_token: jwt({ sub: USER_SUB, aud: USER_CLIENT_ID, nonce: c.nonce, preferred_username: DEMO_USERNAME }), refresh_token: 'fake-refresh-never-shown-0123456789', token_type: 'Bearer', expires_in: 3600, scope: `openid profile ${agentScope}` });
          }
          if (form.grant_type === 'client_credentials') {
            if (auth !== basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: agent client' });
            const asked = String(form.scope || '').split(' ').filter(Boolean);
            if (asked.some((sc) => !state.agentGrants.includes(sc))) return send(400, { error: 'invalid_scope', error_description: 'fake: the agent app has no grant for that scope' });
            const res = asked.length ? resourceOf(form.scope) : null;
            const at = jwt({ sub: AGENT_CLIENT_ID, client_id: AGENT_CLIENT_ID, aud: res ? res.audience : 'fake-agent-api', ...(asked.length ? { scope: asked.join(' ') } : {}) }); issued.agent.add(at);
            return send(200, { access_token: at, token_type: 'Bearer', expires_in: 3600, ...(asked.length ? { scope: asked.join(' ') } : {}) });
          }
          if (form.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
            if (auth !== basicOf(AGENT_CLIENT_ID, AGENT_CLIENT_SECRET)) return send(401, { error: 'invalid_client', error_description: 'fake: agent client' });
            const res = resourceOf(form.scope);
            if (!res) return send(400, { error: 'invalid_scope', error_description: 'fake: no resource owns that scope' });
            if (String(form.scope).split(' ').some((sc) => !state.agentGrants.includes(sc))) return send(400, { error: 'invalid_scope', error_description: 'fake: the agent app has no grant for that scope' });
            if ((state.full.exchange === 'refuse' && res === resources.agent) || (state.full.exchange === 'refuse-2' && res === resources.gateway) || (state.full.exchange === 'refuse-tools' && res === resources.tools)) return send(400, { error: 'invalid_request', error_description: 'fake: exchange refused' });
            if ((state.full.exchange === 'echo' && res === resources.agent) || (state.full.exchange === 'echo-2' && res === resources.gateway)) return send(400, { error: `invalid_request ${form.subject_token}`, error_description: `fake echo: ${form.subject_token} ${AGENT_CLIENT_SECRET} ${String(form.subject_token).slice(0, 40)}` });
            if (state.full.exchange === 'opaque-tools' && res === resources.tools) return send(200, { access_token: 'opaque-token-value-0123456789abcdef', issued_token_type: AT_TYPE, token_type: 'Bearer', expires_in: 900, scope: form.scope });
            const subject = [...issued.user, ...issued.exchange1, ...issued.delegated, ...issued.noAct].includes(form.subject_token) ? claimsIn(form.subject_token) : null;
            if (!subject || form.subject_token_type !== AT_TYPE) return send(400, { error: 'invalid_grant', error_description: 'fake: the subject token is not one this fake issued' });
            let actor = null;
            if (form.actor_token !== undefined) {
              if (!issued.agent.has(form.actor_token) || form.actor_token_type !== AT_TYPE) return send(400, { error: 'invalid_grant', error_description: 'fake: the actor token is not an agent token this fake issued' });
              actor = claimsIn(form.actor_token);
            }
            // The resource's act attribute decides: from the actor token (agent resource) or passed through from the subject token (gateway resource).
            const act = res.act === 'empty' ? {} : res.act === 'blank' ? { sub: '' } : res.act === 'actor' ? (actor ? { sub: actor.client_id } : null) : res.act === 'passthrough' ? (subject.act ?? null) : null;
            const groups = res.groups && state.tools.groups !== null ? { groups: state.tools.groups } : {};
            const at = jwt({ sub: subject.sub, aud: res.audience, scope: form.scope, client_id: AGENT_CLIENT_ID, ...groups, ...(act ? { act } : {}) });
            (res === resources.agent ? issued.exchange1 : act ? issued.delegated : issued.noAct).add(at);
            return send(200, { access_token: at, issued_token_type: AT_TYPE, token_type: 'Bearer', expires_in: 900, scope: form.scope });
          }
          return send(400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'GET' && req.url === `/${ENV_ID}/as/jwks`) return send(200, { keys: [FAKE_PUBLIC_JWK] });
        if (req.method === 'GET' && req.url === `/${ENV_ID}/as/.well-known/openid-configuration`) {
          if (b === 'discovery-500') return send(500, { code: 'UNEXPECTED_ERROR', message: 'fake failure' });
          return send(200, { issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token`, grant_types_supported: ['client_credentials', 'authorization_code', 'urn:ietf:params:oauth:grant-type:token-exchange'], token_endpoint_auth_methods_supported: ['client_secret_basic'], ignored_field: 'not shown' });
        }
        if (req.method === 'POST' && req.url === `/${ENV_ID}/as/token`) {
          const want = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
          if (b === 'bad-secret' || req.headers.authorization !== want) return send(401, { error: 'invalid_client', error_description: 'fake: the client credentials are not valid' });
          return send(200, { access_token: b === 'opaque' ? 'opaque-token-value-0123456789abcdef' : FAKE_TOKEN, token_type: 'Bearer', expires_in: 3600, scope: 'p1:fake', id_token_hint: 'dropped' });
        }
        return send(404, { error: 'not_found' });
      };
      if (state.delayMs) setTimeout(go, state.delayMs); else go();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  issuer = `http://127.0.0.1:${port}/${ENV_ID}/as`;
  return { seen, state, issued, port, base: `http://127.0.0.1:${port}/${ENV_ID}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

export const settingsFor = () => ({ PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', PINGONE_CLIENT_ID: CLIENT_ID, PINGONE_CLIENT_SECRET: CLIENT_SECRET });

// Full Real settings for the fakes (fake values only). gatewayUrl: the fake gateway's URL (loopback http), or null for a lab with NO SE gateway (the three gateway
// names are then left out: Real starts with the local provider only).
export const fullSettingsFor = (gatewayUrl = null, extra = {}) => ({
  PINGONE_ENVIRONMENT_ID: ENV_ID, PINGONE_REGION: 'com', AAG_USER_CLIENT_ID: USER_CLIENT_ID, AAG_USER_CLIENT_SECRET: USER_CLIENT_SECRET, AAG_AGENT_CLIENT_ID: AGENT_CLIENT_ID,
  AAG_AGENT_CLIENT_SECRET: AGENT_CLIENT_SECRET, AAG_DEMO_USERNAME: DEMO_USERNAME,
  ...(gatewayUrl ? { AAG_AGENT_GATEWAY_URL: gatewayUrl, AAG_GATEWAY_AUDIENCE: AUDIENCE, AAG_GATEWAY_SCOPE: SCOPE } : {}), ...extra,
});
