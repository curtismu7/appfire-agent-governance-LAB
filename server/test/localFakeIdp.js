// A fake issuer for the local tool server's tests: OIDC discovery + a JWKS on one loopback port, and a minter for tokens signed with the test keys.
// It is not PingOne. Every token is made at run time (no compact token is stored anywhere); the keys are public-on-purpose test keys.
import http from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';
import { EC_A_JWK, RSA_A_JWK, RSA_B_JWK, publicOf } from './localKeys.js';

export const ENV_ID = '11111111-2222-4333-8444-555555555555';
export const ACTOR = '88888888-9999-4aaa-8bbb-cccccccccccc';
export const AUDIENCE = 'appfire-work-tools';
export const TIER_GROUP = 'Software_EnterpriseTier';
export const ALL_SCOPES = 'issues:read issues:write security:read release:read deploy:read admin:request';
export const KID = { rsa: 'k-rsa-a', ec: 'k-ec-a', rsaB: 'k-rsa-b' };

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

// header and claims are objects; a value of undefined drops the member. Signs with `jwk` (a private JWK) unless `signature` text is given.
export function forge(header, claims, { jwk = null, signature = null } = {}) {
  const input = `${b64u(header)}.${b64u(claims)}`;
  if (signature !== null) return `${input}.${signature}`;
  const key = createPrivateKey({ key: jwk, format: 'jwk' });
  const raw = jwk.kty === 'EC' ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(input), key);
  return `${input}.${raw.toString('base64url')}`;
}

export async function startFakeIdp({ behaviour = 'ok' } = {}) {
  const state = { behaviour, seen: [] };
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    state.seen.push(path);
    const base = `http://127.0.0.1:${server.address().port}/${ENV_ID}/as`;
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const keys = state.behaviour === 'rotated'
      ? [{ ...publicOf(RSA_B_JWK), kid: KID.rsaB, alg: 'RS256', use: 'sig' }]
      : [{ ...publicOf(RSA_A_JWK), kid: KID.rsa, alg: 'RS256', use: 'sig' }, { ...publicOf(EC_A_JWK), kid: KID.ec, alg: 'ES256', use: 'sig' }];
    if (path === `/${ENV_ID}/as/.well-known/openid-configuration`) {
      if (state.behaviour === 'discovery-500') { send(500, { error: 'boom' }); return; }
      if (state.behaviour === 'discovery-wrong-issuer') { send(200, { issuer: 'https://other.example/x/as', jwks_uri: `${base}/jwks` }); return; }
      if (state.behaviour === 'jwks-other-origin') { send(200, { issuer: base, jwks_uri: `http://localhost:${server.address().port}/${ENV_ID}/as/jwks` }); return; }
      send(200, { issuer: base, jwks_uri: `${base}/jwks` });
      return;
    }
    if (path === `/${ENV_ID}/as/jwks`) {
      if (state.behaviour === 'jwks-500') { send(500, { error: 'boom' }); return; }
      if (state.behaviour === 'jwks-html') { send(200, '<html><body>not json</body></html>', 'text/html'); return; }
      if (state.behaviour === 'jwks-huge') { send(200, JSON.stringify({ keys: [], pad: 'a'.repeat(70 * 1024) })); return; }
      if (state.behaviour === 'jwks-redirect') { res.writeHead(302, { location: `${base}/jwks2` }); res.end(); return; }
      if (state.behaviour === 'jwks-slow') return;                       // never answers
      send(200, { keys });
      return;
    }
    if (path === `/${ENV_ID}/as/jwks2`) { send(200, { keys }); return; }
    send(404, { error: 'not_found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const issuer = `http://127.0.0.1:${port}/${ENV_ID}/as`;
  const idp = {
    issuer, base: `http://127.0.0.1:${port}`, port, jwksUri: `${issuer}/jwks`,
    get seen() { return state.seen; },
    setBehaviour(b) { state.behaviour = b; },
    // Claims a good token carries. Pass undefined for a member to drop it.
    claims(over = {}, nowMs = Date.now()) {
      const now = Math.floor(nowMs / 1000);
      return { iss: issuer, sub: 'user-lab-1', act: { sub: ACTOR }, aud: AUDIENCE, scope: ALL_SCOPES, iat: now, exp: now + 900, ...over };
    },
    // A compact token. opts: { alg, kid, jwk (private JWK to sign with), header (extra or overriding header members), nowMs }
    mint(over = {}, { alg = 'RS256', kid, jwk, header = {}, nowMs } = {}) {
      const ec = alg === 'ES256';
      const h = { alg, typ: 'at+jwt', kid: kid ?? (ec ? KID.ec : KID.rsa), ...header };
      return forge(h, idp.claims(over, nowMs), { jwk: jwk ?? (ec ? EC_A_JWK : RSA_A_JWK) });
    },
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
  return idp;
}
