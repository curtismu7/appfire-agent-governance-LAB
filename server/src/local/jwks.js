// The issuer's signing keys, from OIDC discovery. The only URL this module ever fetches is built from the configured issuer, and the one `jwks_uri` the
// discovery document names must sit on the same origin. Nothing a token says (jku, x5u, jwk, kid) can reach `fetchImpl`.
import { isLoopbackHost, parseJson } from './util.js';

const MAX_BYTES = 64 * 1024;
const MAX_KEYS = 20;
const KEEP = ['kty', 'kid', 'x5t', 'x5t#S256', 'use', 'alg', 'key_ops', 'n', 'e', 'crv', 'x', 'y'];

// Reads at most MAX_BYTES (counted while reading) and parses JSON. Any failure is { ok: false }.
async function readJson(res) {
  try {
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) { try { await res.body?.cancel(); } catch { /* nothing to free */ } return { ok: false }; }
    let text = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { try { await reader.cancel(); } catch { /* nothing to free */ } return { ok: false }; }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await res.text();
      if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false };
    }
    const parsed = parseJson(text);
    return parsed.ok && parsed.value !== null && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? { ok: true, value: parsed.value } : { ok: false };
  } catch { return { ok: false }; }
}

const isStr = (v, max = 128) => typeof v === 'string' && v.length >= 1 && v.length <= max;

export function createKeySource({
  issuer, fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now, ttlMs = 300_000, minRefreshMs = 30_000, maxStaleMs = 3_600_000,
  failRetryMs = 5_000, timeoutMs = 5_000,
}) {
  let issuerUrl = null;
  try { issuerUrl = new URL(issuer); } catch { issuerUrl = null; }
  const loopbackIssuer = issuerUrl ? isLoopbackHost(issuerUrl.hostname) : false;
  let cache = null;            // { jwksUri, keys, fetchedAt }
  let inflight = null;
  let lastForcedAt = -Infinity;
  let lastFailAt = -Infinity;
  let lastStatus = 'unknown';

  async function get(url) {
    const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!res || res.status !== 200) { try { await res?.body?.cancel(); } catch { /* nothing to free */ } return { ok: false }; }
    return readJson(res);
  }

  function jwksUriOf(doc) {
    if (!issuerUrl || doc.issuer !== issuer || typeof doc.jwks_uri !== 'string') return null;
    let u;
    try { u = new URL(doc.jwks_uri); } catch { return null; }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopbackIssuer)) return null;
    if (u.origin !== issuerUrl.origin || u.username || u.password || u.search || u.hash) return null;
    return u.href;
  }

  async function fetchSet() {
    try {
      const disc = await get(`${issuer}/.well-known/openid-configuration`);
      if (!disc.ok) return null;
      const jwksUri = jwksUriOf(disc.value);
      if (!jwksUri) return null;
      const set = await get(jwksUri);
      if (!set.ok || !Array.isArray(set.value.keys)) return null;
      const keys = [];
      for (const k of set.value.keys) {
        if (keys.length >= MAX_KEYS) break;
        if (!k || typeof k !== 'object' || Array.isArray(k)) continue;
        if (k.kty !== 'RSA' && k.kty !== 'EC') continue;
        if (!isStr(k.kid) && !isStr(k.x5t) && !isStr(k['x5t#S256'])) continue;
        const kept = {};
        for (const name of KEEP) if (Object.hasOwn(k, name)) kept[name] = k[name];   // never the private members, whatever the set carried
        keys.push(kept);
      }
      return { jwksUri, keys, fetchedAt: now() };
    } catch { return null; }
  }

  // One fetch at a time, shared by every caller.
  function refresh() {
    if (!inflight) {
      inflight = fetchSet().then((set) => {
        if (set) { cache = set; lastStatus = 'ok'; lastFailAt = -Infinity; } else { lastStatus = 'unavailable'; lastFailAt = now(); }
        return Boolean(set);
      }).finally(() => { inflight = null; });
    }
    return inflight;
  }

  const usable = () => cache && now() - cache.fetchedAt < maxStaleMs;

  function find(ident) {
    if (!cache) return null;
    const field = Object.hasOwn(ident, 'kid') ? 'kid' : Object.hasOwn(ident, 'x5t') ? 'x5t' : 'x5t#S256';
    const wanted = field === 'kid' ? ident.kid : field === 'x5t' ? ident.x5t : ident.x5t256;
    const hits = cache.keys.filter((k) => Object.hasOwn(k, field) && k[field] === wanted);
    return hits.length === 1 ? hits[0] : null;       // a duplicate id matches neither key
  }

  return {
    status: () => lastStatus,
    // ident: { kid } | { x5t } | { x5t256 }. Resolves { ok: true, jwk } or { ok: false, reason: 'jwks_unavailable' | 'kid_unknown' }.
    async getKey(ident) {
      let freshHere = false;
      const stale = !cache || now() - cache.fetchedAt >= ttlMs;
      if (stale) {
        // After a failed fetch, wait before trying again (a dead issuer must not be hit by every request).
        if (!(now() - lastFailAt < (cache ? minRefreshMs : failRetryMs))) freshHere = await refresh();
      }
      if (!usable()) return { ok: false, reason: 'jwks_unavailable' };
      let jwk = find(ident);
      if (!jwk && !freshHere && now() - lastForcedAt >= minRefreshMs) {
        lastForcedAt = now();                          // one shared limiter: random kids cannot cause more than one fetch pair per window
        await refresh();
        if (!usable()) return { ok: false, reason: 'jwks_unavailable' };
        jwk = find(ident);
      }
      return jwk ? { ok: true, jwk } : { ok: false, reason: 'kid_unknown' };
    },
  };
}
