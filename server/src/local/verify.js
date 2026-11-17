// The JWT check, in a fixed order with fixed reason codes (design B.4). The first failure wins. Only a reason code ever leaves this module:
// no claim value, no token text and no exception message.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { b64urlDecode, isObj, parseJson } from './util.js';

const MAX_TOKEN = 8192;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ALGS = ['RS256', 'ES256'];
const FORBIDDEN_HEADERS = ['jku', 'x5u', 'jwk', 'x5c', 'crit'];

const fail = (reason, status = 401) => ({ ok: false, status, reason });
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const idOk = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 128;

function bitLength(buf) {
  let i = 0;
  while (i < buf.length && buf[i] === 0) i += 1;
  if (i === buf.length) return 0;
  return (buf.length - i) * 8 - Math.clz32(buf[i]) + 24;
}

// Does the matched key fit the token's algorithm? Returns a KeyObject or null (key_mismatch).
const imported = new WeakMap();
function keyObjectFor(jwk, alg) {
  if (!isObj(jwk)) return null;
  const use = own(jwk, 'use'); const kalg = own(jwk, 'alg'); const ops = own(jwk, 'key_ops');
  if (use !== undefined && use !== 'sig') return null;
  if (kalg !== undefined && kalg !== alg) return null;
  if (ops !== undefined && !(Array.isArray(ops) && ops.includes('verify'))) return null;
  if (imported.has(jwk)) { const hit = imported.get(jwk); return hit.alg === alg ? hit.key : null; }
  let key = null;
  try {
    if (alg === 'RS256') {
      if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
      const n = b64urlDecode(jwk.n);
      if (!n) return null;
      const bits = bitLength(n);
      if (bits < 2048 || bits > 8192) return null;
      key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    } else {
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
      key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    }
  } catch { return null; }
  imported.set(jwk, { alg, key });
  return key;
}

// scope first, else scp; a space-separated string or an array of strings; the two are never merged.
function scopesOf(claims) {
  const name = Object.hasOwn(claims, 'scope') ? 'scope' : Object.hasOwn(claims, 'scp') ? 'scp' : null;
  if (!name) return null;
  const v = claims[name];
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean).slice(0, 200);
  if (Array.isArray(v) && v.every((s) => typeof s === 'string')) return v.flatMap((s) => s.split(/\s+/).filter(Boolean)).slice(0, 200);
  return null;
}

const groupsOf = (claims) => {
  const g = own(claims, 'groups');
  if (typeof g === 'string') return [g];
  return Array.isArray(g) ? g.filter((s) => typeof s === 'string').slice(0, 500) : [];
};

// act: an object with a non-empty string sub; a JSON string holding one is parsed once.
function actOf(claims) {
  let act = own(claims, 'act');
  if (typeof act === 'string') { const p = parseJson(act); act = p.ok ? p.value : undefined; }
  return isObj(act) && typeof own(act, 'sub') === 'string' && own(act, 'sub').trim() !== '' ? own(act, 'sub') : null;
}

export function createVerifier({ issuer, audience, allowedActors, skewSeconds = 60, keySource, now = Date.now }) {
  // authorization: the header value, undefined when absent, or an array when the header was repeated.
  return async function verifyAuthorization(authorization) {
    if (authorization === undefined || authorization === null) return fail('no_token');
    if (typeof authorization !== 'string' || !/^bearer /i.test(authorization)) return fail('bad_scheme');
    const token = authorization.slice(7);
    if (token === '' || token.startsWith(' ') || token.includes(',')) return fail('bad_scheme');
    if (Buffer.byteLength(token) > MAX_TOKEN) return fail('token_too_large');
    if (!TOKEN_SHAPE.test(token)) return fail('malformed_token');
    const [h, p, s] = token.split('.');
    const hb = b64urlDecode(h); const pb = b64urlDecode(p); const sb = b64urlDecode(s);
    if (!hb || !pb || !sb) return fail('malformed_token');
    const header = parseJson(hb.toString('utf8')); const payload = parseJson(pb.toString('utf8'));
    if (!header.ok || !payload.ok || !isObj(header.value) || !isObj(payload.value)) return fail('malformed_token');
    const head = header.value; const claims = payload.value;

    const alg = own(head, 'alg');
    if (typeof alg !== 'string' || !ALGS.includes(alg)) return fail('alg_not_allowed');
    if (FORBIDDEN_HEADERS.some((k) => Object.hasOwn(head, k))) return fail('header_not_allowed');
    const ident = idOk(own(head, 'kid')) ? { kid: head.kid } : idOk(own(head, 'x5t')) ? { x5t: head.x5t } : idOk(own(head, 'x5t#S256')) ? { x5t256: head['x5t#S256'] } : null;
    if (!ident) return fail('kid_missing');

    const found = await keySource.getKey(ident);
    if (!found.ok) return found.reason === 'jwks_unavailable' ? fail('jwks_unavailable', 503) : fail('kid_unknown');
    const key = keyObjectFor(found.jwk, alg);
    if (!key) return fail('key_mismatch');

    let good = false;
    try {
      if (alg === 'ES256') good = sb.length === 64 && cryptoVerify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, sb);
      else good = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), key, sb);
    } catch { good = false; }
    if (!good) return fail('signature_invalid');

    if (own(claims, 'iss') !== issuer) return fail('iss_mismatch');
    const aud = own(claims, 'aud');
    if (!(aud === audience || (Array.isArray(aud) && aud.some((a) => a === audience)))) return fail('aud_mismatch');
    const exp = own(claims, 'exp');
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return fail('exp_missing');
    const nowSeconds = Math.floor(now() / 1000);
    if (nowSeconds > exp + skewSeconds) return fail('token_expired');
    for (const name of ['nbf', 'iat']) {
      if (!Object.hasOwn(claims, name)) continue;
      const v = claims[name];
      if (typeof v !== 'number' || !Number.isFinite(v) || v > nowSeconds + skewSeconds) return fail('token_not_yet_valid');
    }
    const sub = own(claims, 'sub');
    if (typeof sub !== 'string' || sub === '') return fail('sub_missing');
    const actSub = actOf(claims);
    if (actSub === null) return fail('act_missing');
    if (!allowedActors.includes(actSub)) return fail('act_sub_mismatch');
    const scopes = scopesOf(claims);
    if (!scopes) return fail('scope_claim_missing');
    return { ok: true, claims, header: head, scopes, groups: groupsOf(claims), actSub };
  };
}
