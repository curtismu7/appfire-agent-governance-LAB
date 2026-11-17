// The local tool server's token verifier (design B.4): one hostile case per row, the key source, and the failures of the issuer's JWKS.
// Driven against a fake issuer on loopback (localFakeIdp.js) and, where a key set must be shaped by hand, against an injected fetch.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createKeySource } from '../src/local/jwks.js';
import { createVerifier } from '../src/local/verify.js';
import { ACTOR, ALL_SCOPES, AUDIENCE, KID, forge, startFakeIdp } from './localFakeIdp.js';
import { EC_A_JWK, RSA_A_JWK, RSA_B_JWK, RSA_WEAK_JWK, publicOf } from './localKeys.js';

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const sec = Math.floor(NOW / 1000);
let idp;
before(async () => { idp = await startFakeIdp(); });
after(async () => { await idp.close(); });

// A verifier with its own key source and a movable clock.
function rig({ keySource, allowedActors = [ACTOR], ks = {} } = {}) {
  const clock = { t: NOW };
  const now = () => clock.t;
  const source = keySource ?? createKeySource({ issuer: idp.issuer, now, timeoutMs: 15_000, ...ks });
  const verifier = createVerifier({ issuer: idp.issuer, audience: AUDIENCE, allowedActors, keySource: source, now });
  return { clock, source, check: (t) => verifier(`Bearer ${t}`), raw: (h) => verifier(h) };
}
const mint = (over, opts) => idp.mint(over, { nowMs: NOW, ...opts });
const claims = (over) => idp.claims(over, NOW);
const refused = (r, reason, status = 401) => { assert.equal(r.ok, false); assert.equal(r.reason, reason); assert.equal(r.status, status); };

// A fetch that serves a discovery document and a key set the test shapes. `keys` may be changed between calls.
function fetchFor(state) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const body = u.endsWith('/.well-known/openid-configuration') ? { issuer: idp.issuer, jwks_uri: `${idp.issuer}/jwks` } : { keys: state.keys };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const rigWith = (keys, extra = {}) => {
  const state = { keys };
  const fetchImpl = fetchFor(state);
  const clock = { t: NOW };
  const now = () => clock.t;
  const source = createKeySource({ issuer: idp.issuer, fetchImpl, now, ...extra });
  const verifier = createVerifier({ issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], keySource: source, now });
  return { state, fetchImpl, clock, source, check: (t) => verifier(`Bearer ${t}`) };
};
const pubA = { ...publicOf(RSA_A_JWK), kid: KID.rsa };

test('a good RS256 token and a good ES256 token pass and give claims, scopes, groups and actSub', async () => {
  const { check } = rig();
  const a = await check(mint({ groups: ['Software_EnterpriseTier'] }));
  assert.equal(a.ok, true);
  assert.equal(a.actSub, ACTOR);
  assert.deepEqual(a.scopes, ALL_SCOPES.split(' '));
  assert.deepEqual(a.groups, ['Software_EnterpriseTier']);
  assert.equal(a.claims.sub, 'user-lab-1');
  const b = await check(mint({}, { alg: 'ES256' }));
  assert.equal(b.ok, true);
});

test('row 1 to 4: header shapes and token shapes', async () => {
  const { raw, check } = rig();
  refused(await raw(undefined), 'no_token');
  refused(await raw(['Bearer a.b.c']), 'bad_scheme');
  refused(await raw('Basic dXNlcjpwdw=='), 'bad_scheme');
  refused(await raw('Bearer  x.y.z'), 'bad_scheme');
  refused(await raw('Bearer '), 'bad_scheme');
  refused(await raw('Bearer a.b.c, Bearer d.e.f'), 'bad_scheme');
  refused(await raw(`Bearer ${'a'.repeat(8193)}`), 'token_too_large');
  refused(await raw('Bearer a.b'), 'malformed_token');
  refused(await raw('Bearer a.b.c.d'), 'malformed_token');
  refused(await raw('Bearer a b.c.d'), 'malformed_token');
  refused(await raw('Bearer a.b.c!d'), 'malformed_token');
  refused(await raw('Bearer a..c'), 'malformed_token');
  const good = mint({});
  assert.equal((await raw(`bearer ${good}`)).ok, true, 'the scheme is case-insensitive');
  assert.equal((await raw(`BEARER ${good}`)).ok, true);
  refused(await check(`${good.split('.')[0]}.${good.split('.')[1]}.`), 'malformed_token');
  const notJson = Buffer.from('not json {{').toString('base64url');
  refused(await check(`${notJson}.${notJson}.QUJD`), 'malformed_token');
  const arr = Buffer.from('[1]').toString('base64url');
  refused(await check(`${arr}.${arr}.QUJD`), 'malformed_token');
});

test('a token that makes JSON.parse throw puts no slice of itself in anything returned', async () => {
  const { check } = rig();
  const junk = Buffer.from('SECRETISH{{ not json: abcdefghijklmnop').toString('base64url');
  const token = `${junk}.${junk}.${Buffer.from('signature-bytes-here').toString('base64url')}`;
  const r = await check(token);
  refused(r, 'malformed_token');
  const out = JSON.stringify(r);
  for (let i = 0; i + 8 <= token.length; i += 1) assert.ok(!out.includes(token.slice(i, i + 8)), 'no 8-char slice of the token');
});

test('row 5: only RS256 and ES256 are allowed (none, HS*, RS384, PS256, lowercase, missing)', async () => {
  const { check } = rig();
  const c = claims({});
  refused(await check(forge({ alg: 'none', kid: KID.rsa }, c, { signature: 'c2ln' })), 'alg_not_allowed');
  refused(await check(forge({ alg: 'none', kid: KID.rsa }, c, { signature: '' })), 'malformed_token');
  const twoSegments = forge({ alg: 'none', kid: KID.rsa }, c, { signature: 'x' }).split('.').slice(0, 2).join('.');
  refused(await check(twoSegments), 'malformed_token');
  // RS256 key confusion: HS256 with the public key's text as the secret
  const input = (h) => `${Buffer.from(JSON.stringify(h)).toString('base64url')}.${Buffer.from(JSON.stringify(c)).toString('base64url')}`;
  const hs = { alg: 'HS256', kid: KID.rsa };
  const confused = `${input(hs)}.${createHmac('sha256', JSON.stringify(publicOf(RSA_A_JWK))).update(input(hs)).digest('base64url')}`;
  refused(await check(confused), 'alg_not_allowed');
  const random = `${input(hs)}.${createHmac('sha256', 'a random secret').update(input(hs)).digest('base64url')}`;
  refused(await check(random), 'alg_not_allowed');
  for (const alg of ['HS384', 'HS512', 'RS384', 'PS256', 'rs256', 'ES384', 'EdDSA']) refused(await check(forge({ alg, kid: KID.rsa }, c, { jwk: RSA_A_JWK })), 'alg_not_allowed');
  refused(await check(forge({ kid: KID.rsa }, c, { jwk: RSA_A_JWK })), 'alg_not_allowed');
  refused(await check(forge({ alg: ['RS256'], kid: KID.rsa }, c, { jwk: RSA_A_JWK })), 'alg_not_allowed');
});

test('row 6: a token may not pick or carry its own key', async () => {
  const { check } = rig();
  for (const header of [{ jku: 'http://evil.example/jwks' }, { x5u: 'http://evil.example/cert' }, { jwk: publicOf(RSA_A_JWK) }, { x5c: ['AAAA'] }, { crit: ['b64'] }]) {
    refused(await check(mint({}, { header })), 'header_not_allowed');
  }
  assert.deepEqual(idp.seen.filter((p) => /evil/.test(p)), []);
});

test('row 7 and 9: kid, x5t and the unknown-kid refresh limit', async () => {
  const { check } = rig();
  refused(await check(mint({}, { header: { kid: undefined } })), 'kid_missing');
  refused(await check(mint({}, { header: { kid: 7 } })), 'kid_missing');
  refused(await check(mint({}, { header: { kid: '' } })), 'kid_missing');
  const r = rigWith([{ ...pubA, kid: undefined, x5t: 'thumb-1' }]);
  assert.equal((await r.check(mint({}, { header: { kid: undefined, x5t: 'thumb-1' } }))).ok, true, 'x5t selects a key when there is no kid');
  refused(await r.check(mint({}, { header: { kid: undefined, x5t: 'thumb-2' } })), 'kid_unknown');
  const r2 = rigWith([{ ...pubA, kid: undefined, 'x5t#S256': 'thumb-256' }]);
  assert.equal((await r2.check(mint({}, { header: { kid: undefined, 'x5t#S256': 'thumb-256' } }))).ok, true);
});

test('unknown kid: one forced refresh, then none within 30 s, then one again after 30 s', async () => {
  const r = rigWith([pubA]);
  assert.equal((await r.check(mint({}))).ok, true);
  assert.equal(r.fetchImpl.calls.length, 2, 'discovery + jwks');
  r.clock.t += 1000;
  refused(await r.check(mint({}, { kid: 'nope-1', jwk: RSA_A_JWK })), 'kid_unknown');
  assert.equal(r.fetchImpl.calls.length, 4, 'one forced refresh');
  r.clock.t += 1000;
  refused(await r.check(mint({}, { kid: 'nope-2', jwk: RSA_A_JWK })), 'kid_unknown');
  refused(await r.check(mint({}, { kid: 'nope-3', jwk: RSA_A_JWK })), 'kid_unknown');
  assert.equal(r.fetchImpl.calls.length, 4, 'a second unknown kid inside 30 s does NOT refetch');
  r.clock.t += 31_000;
  refused(await r.check(mint({}, { kid: 'nope-4', jwk: RSA_A_JWK })), 'kid_unknown');
  assert.equal(r.fetchImpl.calls.length, 6);
});

test('the first request fetches once, not twice, even for an unknown kid', async () => {
  const r = rigWith([pubA]);
  refused(await r.check(mint({}, { kid: 'nope', jwk: RSA_A_JWK })), 'kid_unknown');
  assert.equal(r.fetchImpl.calls.length, 2);
});

test('a successful rotation after kid_unknown works', async () => {
  const state = { keys: [pubA] };
  const r = rigWith(state.keys);
  assert.equal((await r.check(mint({}))).ok, true);
  const tokenB = mint({}, { kid: KID.rsaB, jwk: RSA_B_JWK });
  r.state.keys = [{ ...publicOf(RSA_B_JWK), kid: KID.rsaB }];
  r.clock.t += 31_000;
  assert.equal((await r.check(mint({}, { kid: KID.rsaB, jwk: RSA_B_JWK, nowMs: r.clock.t }))).ok, true);
  void tokenB;
});

test('rotation against the fake issuer itself', async () => {
  const { check, clock } = rig();
  assert.equal((await check(mint({}))).ok, true);
  idp.setBehaviour('rotated');
  clock.t += 1000;
  assert.equal((await check(mint({}, { kid: KID.rsaB, jwk: RSA_B_JWK, nowMs: clock.t }))).ok, true);
  idp.setBehaviour('ok');
});

test('row 9: a kid that appears on two keys matches neither', async () => {
  const r = rigWith([pubA, { ...publicOf(RSA_B_JWK), kid: KID.rsa }]);
  refused(await r.check(mint({})), 'kid_unknown');
});

test('row 10: a key that does not fit is key_mismatch', async () => {
  const tests = [
    ['kty is EC for an RS256 token', { ...publicOf(EC_A_JWK), kid: KID.rsa }, {}],
    ['alg on the key differs', { ...pubA, alg: 'ES256' }, {}],
    ['use is enc', { ...pubA, use: 'enc' }, {}],
    ['key_ops lacks verify', { ...pubA, key_ops: ['sign'] }, {}],
    ['key_ops is not an array', { ...pubA, key_ops: 'verify' }, {}],
    ['the modulus is 1024 bits', { ...publicOf(RSA_WEAK_JWK), kid: KID.rsa }, { jwk: RSA_WEAK_JWK }],
    ['the modulus is 8200 bits', { kty: 'RSA', e: 'AQAB', kid: KID.rsa, n: Buffer.concat([Buffer.from([0x80]), Buffer.alloc(1024)]).toString('base64url') }, {}],
    ['the modulus is not base64url', { kty: 'RSA', e: 'AQAB', kid: KID.rsa, n: '!!!' }, {}],
    ['the RSA members are missing', { kty: 'RSA', kid: KID.rsa }, {}],
  ];
  for (const [name, key, opts] of tests) {
    const r = rigWith([key]);
    const out = await r.check(mint({}, opts));
    assert.equal(out.reason, 'key_mismatch', name);
  }
  const ec = rigWith([{ ...publicOf(EC_A_JWK), kid: KID.ec, crv: 'P-384' }]);
  refused(await ec.check(mint({}, { alg: 'ES256' })), 'key_mismatch');
  const ecWrongKty = rigWith([{ ...pubA, kid: KID.ec }]);
  refused(await ecWrongKty.check(mint({}, { alg: 'ES256' })), 'key_mismatch');
  const ecBad = rigWith([{ kty: 'EC', crv: 'P-256', x: 'AAAA', y: 'AAAA', kid: KID.ec }]);
  refused(await ecBad.check(mint({}, { alg: 'ES256' })), 'key_mismatch');
});

test('row 11: signatures', async () => {
  const { check } = rig();
  refused(await check(mint({}, { jwk: RSA_B_JWK })), 'signature_invalid');
  const good = mint({});
  const [h, p, s] = good.split('.');
  const bumped = Buffer.from(JSON.stringify({ ...claims({}), scope: `${ALL_SCOPES} extra:scope` })).toString('base64url');
  refused(await check(`${h}.${bumped}.${s}`), 'signature_invalid');
  const header2 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID.rsa })).toString('base64url');
  refused(await check(`${header2}.${p}.${s}`), 'signature_invalid');
  for (const n of [63, 65, 0 + 1]) refused(await check(forge({ alg: 'ES256', kid: KID.ec }, claims({}), { signature: Buffer.alloc(n, 1).toString('base64url') })), 'signature_invalid');
  refused(await check(forge({ alg: 'ES256', kid: KID.ec }, claims({}), { signature: Buffer.alloc(64, 1).toString('base64url') })), 'signature_invalid');
  refused(await check(forge({ alg: 'RS256', kid: KID.rsa }, claims({}), { signature: Buffer.alloc(256, 1).toString('base64url') })), 'signature_invalid');
  refused(await check(forge({ alg: 'RS256', kid: KID.rsa }, claims({}), { signature: 'AAAA' })), 'signature_invalid');
  // an RS256 signature presented as ES256 and the other way round
  refused(await check(forge({ alg: 'ES256', kid: KID.rsa }, claims({}), { jwk: RSA_A_JWK })), 'key_mismatch');
});

test('rows 12 to 16: iss, aud, exp, nbf, iat with a 60 second skew', async () => {
  const { check } = rig();
  for (const iss of [`${idp.issuer}/`, 'https://other.example/x/as', idp.issuer.toUpperCase(), undefined, 7]) refused(await check(mint({ iss })), 'iss_mismatch');
  for (const aud of ['someone-else', ['someone-else', 'another'], undefined, 5, []]) refused(await check(mint({ aud })), 'aud_mismatch');
  assert.equal((await check(mint({ aud: ['other', AUDIENCE] }))).ok, true);
  refused(await check(mint({ exp: sec - 61 })), 'token_expired');
  assert.equal((await check(mint({ exp: sec - 59 }))).ok, true);
  refused(await check(mint({ exp: undefined })), 'exp_missing');
  refused(await check(mint({ exp: 'soon' })), 'exp_missing');
  refused(await check(mint({ exp: null })), 'exp_missing');
  refused(await check(mint({ nbf: sec + 61 })), 'token_not_yet_valid');
  assert.equal((await check(mint({ nbf: sec + 59 }))).ok, true);
  refused(await check(mint({ iat: sec + 61 })), 'token_not_yet_valid');
  assert.equal((await check(mint({ iat: sec + 59 }))).ok, true);
  refused(await check(mint({ nbf: 'later' })), 'token_not_yet_valid');
});

test('rows 17 to 19: sub and act', async () => {
  const { check } = rig();
  for (const sub of [undefined, '', 5]) refused(await check(mint({ sub })), 'sub_missing');
  for (const act of [undefined, {}, [], [{ sub: ACTOR }], { sub: '' }, { sub: '  ' }, { sub: 5 }, 'not json', '[]', null, 7]) refused(await check(mint({ act })), 'act_missing');
  const asString = await check(mint({ act: JSON.stringify({ sub: ACTOR }) }));
  assert.equal(asString.ok, true, 'a JSON string act is parsed once');
  assert.equal(asString.actSub, ACTOR);
  refused(await check(mint({ act: JSON.stringify(JSON.stringify({ sub: ACTOR })) })), 'act_missing');
  refused(await check(mint({ act: { sub: 'someone-else' } })), 'act_sub_mismatch');
  refused(await check(mint({ act: { sub: ACTOR.toUpperCase() } })), 'act_sub_mismatch');
});

test('row 20: the scope claim', async () => {
  const { check } = rig();
  assert.deepEqual((await check(mint({ scope: 'issues:read  issues:write' }))).scopes, ['issues:read', 'issues:write']);
  assert.deepEqual((await check(mint({ scope: ['issues:read', 'deploy:read'] }))).scopes, ['issues:read', 'deploy:read']);
  assert.deepEqual((await check(mint({ scope: undefined, scp: 'issues:read' }))).scopes, ['issues:read']);
  assert.deepEqual((await check(mint({ scope: undefined, scp: ['issues:write'] }))).scopes, ['issues:write']);
  assert.deepEqual((await check(mint({ scope: 'issues:read', scp: 'issues:write' }))).scopes, ['issues:read'], 'scope wins, the two are never merged');
  refused(await check(mint({ scope: undefined })), 'scope_claim_missing');
  refused(await check(mint({ scope: 5 })), 'scope_claim_missing');
  refused(await check(mint({ scope: [1, 2] })), 'scope_claim_missing');
  refused(await check(mint({ scope: { a: 1 } })), 'scope_claim_missing');
  refused(await check(mint({ scope: 5, scp: 'issues:read' })), 'scope_claim_missing');
});

test('groups are read as an array or as one string, and never from anything else', async () => {
  const { check } = rig();
  assert.deepEqual((await check(mint({ groups: 'Software_EnterpriseTier' }))).groups, ['Software_EnterpriseTier']);
  assert.deepEqual((await check(mint({ groups: ['a', 1, 'b'] }))).groups, ['a', 'b']);
  assert.deepEqual((await check(mint({}))).groups, []);
  assert.deepEqual((await check(mint({ groups: { a: 1 } }))).groups, []);
});

test('claims are read with own properties only (a __proto__ member is just data)', async () => {
  const { check } = rig();
  const header = { alg: 'RS256', kid: KID.rsa };
  const text = `{"iss":${JSON.stringify(idp.issuer)},"__proto__":{"sub":"polluted"},"aud":${JSON.stringify(AUDIENCE)},"exp":${sec + 900},"act":{"sub":${JSON.stringify(ACTOR)}},"scope":"issues:read"}`;
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(text).toString('base64url')}`;
  const { sign, createPrivateKey } = await import('node:crypto');
  const token = `${input}.${sign('sha256', Buffer.from(input), createPrivateKey({ key: RSA_A_JWK, format: 'jwk' })).toString('base64url')}`;
  refused(await check(token), 'sub_missing');
  assert.equal({}.sub, undefined);
});

// The slow issuer is modelled in the key source's own fetch (a call that hangs, then fails like a timeout) for the success-and-recovery phases, so a heavily loaded machine cannot
// time out a call that is supposed to succeed (the earlier 1.5 s real timeout did exactly that). The real AbortSignal timeout is exercised once, below, where timing out IS the pass.
const hang = () => new Promise((_resolve, reject) => { setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), 100); });
for (const behaviour of ['jwks-500', 'jwks-html', 'jwks-huge', 'jwks-redirect', 'jwks-slow', 'discovery-500', 'discovery-wrong-issuer', 'jwks-other-origin']) {
  test(`row 8: issuer behaviour ${behaviour} is jwks_unavailable (503) with no cache, and the cache serves for up to an hour`, async () => {
    const slow = behaviour === 'jwks-slow';
    const gate = { on: false };
    const set = (b) => { if (slow) gate.on = b !== 'ok'; else idp.setBehaviour(b); };
    try {
      const ks = slow ? { fetchImpl: (url, init) => (gate.on ? hang() : fetch(url, init)) } : {};
      set(behaviour);
      const cold = rig({ ks });
      refused(await cold.check(mint({})), 'jwks_unavailable', 503);
      // once the issuer works the next try (after the retry floor) succeeds
      set('ok');
      cold.clock.t += 6000;
      assert.equal((await cold.check(mint({}, { nowMs: cold.clock.t }))).ok, true);
      // with a warm cache the breakage is invisible until the cache is an hour old
      const warm = rig({ ks });
      assert.equal((await warm.check(mint({}))).ok, true);
      set(behaviour);
      warm.clock.t += 301_000;
      assert.equal((await warm.check(mint({}, { nowMs: warm.clock.t }))).ok, true, 'a stale set is used while the refresh fails');
      warm.clock.t += 3_200_000;
      assert.equal((await warm.check(mint({}, { nowMs: warm.clock.t }))).ok, true, 'still younger than one hour');
      warm.clock.t += 400_000;
      refused(await warm.check(mint({}, { nowMs: warm.clock.t })), 'jwks_unavailable', 503);
    } finally { idp.setBehaviour('ok'); }
  });
}

test('a JWKS that never answers is abandoned at the timeout (the real AbortSignal path): 503, never a hang', async () => {
  idp.setBehaviour('jwks-slow');
  try {
    const { check } = rig({ ks: { timeoutMs: 700 } });
    const t0 = Date.now();
    refused(await check(mint({})), 'jwks_unavailable', 503);
    assert.ok(Date.now() - t0 < 10_000, 'it gave up instead of waiting');
  } finally { idp.setBehaviour('ok'); }
});

test('a redirect from the issuer is never followed', async () => {
  idp.setBehaviour('jwks-redirect');
  try {
    const before = idp.seen.length;
    const { check } = rig();
    refused(await check(mint({})), 'jwks_unavailable', 503);
    assert.ok(!idp.seen.slice(before).some((p) => p.endsWith('/jwks2')), 'jwks2 was never requested');
  } finally { idp.setBehaviour('ok'); }
});

test('the key source: discovery cached with the set, at most 20 keys, only RSA and EC with an id, private members stripped, no URL from anywhere else', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...pubA, kid: `k-${i}` }));
  const r = rigWith([{ kty: 'oct', k: 'AAAA', kid: 'sym' }, { ...pubA, kid: undefined }, { ...pubA, kid: 'with-private', d: 'PRIVATE-MEMBER', p: 'x' }, ...many]);
  const found = await r.source.getKey({ kid: 'with-private' });
  assert.equal(found.ok, true);
  assert.equal(Object.hasOwn(found.jwk, 'd'), false);
  assert.equal(Object.hasOwn(found.jwk, 'p'), false);
  assert.deepEqual((await r.source.getKey({ kid: 'sym' })).reason, 'kid_unknown');
  assert.equal((await r.source.getKey({ kid: 'k-17' })).ok, true, 'within the first 20 kept keys');
  assert.equal((await r.source.getKey({ kid: 'k-29' })).ok, false, 'past the 20-key cap');
  assert.deepEqual(r.fetchImpl.calls.slice(0, 2), [`${idp.issuer}/.well-known/openid-configuration`, `${idp.issuer}/jwks`]);
  assert.ok(r.fetchImpl.calls.every((u) => u.startsWith(idp.issuer)), 'every fetch is built from the configured issuer');
});

test('concurrent first requests share one fetch pair', async () => {
  const r = rigWith([pubA]);
  const results = await Promise.all(Array.from({ length: 8 }, () => r.check(mint({}))));
  assert.ok(results.every((x) => x.ok));
  assert.equal(r.fetchImpl.calls.length, 2);
});

test('the key set is re-read after its 300 second life, and discovery with it', async () => {
  const r = rigWith([pubA]);
  await r.check(mint({}));
  r.clock.t += 299_000;
  await r.check(mint({}, { nowMs: r.clock.t }));
  assert.equal(r.fetchImpl.calls.length, 2);
  r.clock.t += 2000;
  await r.check(mint({}, { nowMs: r.clock.t }));
  assert.equal(r.fetchImpl.calls.length, 4);
});

test('a discovery document that names a jwks_uri off the issuer origin, with credentials, a query or a fragment is refused', async () => {
  for (const uri of ['http://localhost:1/x', `${idp.issuer}/jwks?x=1`, `${idp.issuer}/jwks#f`, 'ftp://127.0.0.1/x', 42, undefined]) {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(String(url).endsWith('openid-configuration') ? { issuer: idp.issuer, jwks_uri: uri } : { keys: [pubA] }), { status: 200 });
    };
    const source = createKeySource({ issuer: idp.issuer, fetchImpl, now: () => NOW });
    assert.deepEqual(await source.getKey({ kid: KID.rsa }), { ok: false, reason: 'jwks_unavailable' });
    assert.equal(calls.length, 1, 'the jwks was never fetched');
  }
});

test('the verifier never builds a URL from a token: a hostile jku, x5u and kid reach no fetch', async () => {
  const calls = [];
  const source = createKeySource({ issuer: idp.issuer, now: () => NOW, fetchImpl: async (u) => { calls.push(String(u)); return new Response('{}', { status: 500 }); } });
  const v = createVerifier({ issuer: idp.issuer, audience: AUDIENCE, allowedActors: [ACTOR], keySource: source, now: () => NOW });
  await v(`Bearer ${mint({}, { header: { jku: 'http://evil.example/' } })}`);
  await v(`Bearer ${mint({}, { kid: 'http://evil.example/' })}`);
  assert.ok(calls.every((u) => u.startsWith(idp.issuer)));
});
