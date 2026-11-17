// Small helpers shared by the local tool server. Node built-ins only (the isolation rule: this directory imports nothing from the lab).
import { createHash, timingSafeEqual } from 'node:crypto';

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const sha256hex = (text) => createHash('sha256').update(text).digest('hex');

// Both sides are hashed first, so a wrong length leaks nothing and timingSafeEqual always gets two equal-length buffers.
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

// base64url text to a Buffer, or null. A length of 1 mod 4 can never be base64.
export function b64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  return Buffer.from(text, 'base64url');
}

// JSON.parse that never throws and never puts a slice of the input into an error.
export function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, value: null }; }
}

// Key-sorted, recursive JSON, so two objects with the same content digest the same whatever their key order.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export const isLoopbackHost = (host) => {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '::ffff:127.0.0.1' || /^127(\.\d{1,3}){3}$/.test(h);
};

// A plain DNS name (at least one dot), never an IP literal, a wildcard or a pattern.
export const isPlainDnsName = (host) => {
  const h = String(host ?? '').toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(h) && !/^\d+(\.\d+){3}$/.test(h);
};

// A W3C traceparent `00-<32 hex>-<16 hex>-<2 hex>` gives its trace id; anything else is null.
export function traceIdOf(header) {
  if (typeof header !== 'string') return null;
  const m = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(header.trim());
  return m && m[1] !== '0'.repeat(32) ? m[1] : null;
}

// Reads a request body up to `max` bytes, and gives up after `deadlineMs` (a stalled body must not hold a slot for ever). On a deadline the request is destroyed.
// Resolves { ok: true, text } or { ok: false, tooLarge: true } or { ok: false, tooLarge: false, timedOut?: true }.
export function readBody(req, max, { deadlineMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) { resolve({ ok: false, tooLarge: true }); return; }
    const chunks = [];
    let size = 0;
    let done = false;
    let timer = null;
    const finish = (r) => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(r); } };
    timer = setTimeout(() => { finish({ ok: false, tooLarge: false, timedOut: true }); try { req.destroy(); } catch { /* already gone */ } }, deadlineMs);
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > max) { chunks.length = 0; finish({ ok: false, tooLarge: true }); return; }
      chunks.push(c);
    });
    req.on('end', () => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => finish({ ok: false, tooLarge: false }));
    req.on('aborted', () => finish({ ok: false, tooLarge: false }));
    req.on('close', () => finish({ ok: false, tooLarge: false }));
  });
}
