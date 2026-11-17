// Small helpers shared by the local tool server. Node built-ins only (the isolation rule: this directory imports nothing from the lab).
import { createHash, timingSafeEqual } from 'node:crypto';
import { AUTHORIZE_CODES, AUTHORIZE_REASONS } from './registry.js';

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

// The child's side of the PingOne Authorize question (design-authorize-lab.md B.2). The child has no network and no secret: it sends the parent ONE message per booking and waits for
// the parent's answer, which binds ONLY by id. SILENCE IS NEVER A PERMIT: no answer in `waitMs` is a no decision, and so is a bad shape, a full queue or a dead channel.
export const AUTHORIZE_OUTCOMES = Object.freeze(['permit', 'narrow', 'approval', 'approved', 'second_factor', 'deny', 'no_decision']);
const RESULT_KEYS = ['code', 'correlationId', 'elapsedMs', 'id', 'outcome', 'reason', 'type'];
const MAX_ID = 2147483647;
const noDecision = (reason) => ({ outcome: 'no_decision', code: null, reason, correlationId: null, elapsedMs: null });

// The parent's reply, or null when its shape is wrong (an extra or missing key, an outcome or reason outside the enums, a code not allowed for that outcome, a reason on a decision).
export function shapeOfResult(m) {
  if (!isObj(m) || Object.keys(m).sort().join() !== RESULT_KEYS.join()) return null;
  if (!AUTHORIZE_OUTCOMES.includes(m.outcome)) return null;
  if (m.outcome === 'no_decision') { if (m.code !== null || !AUTHORIZE_REASONS.includes(m.reason)) return null; }
  else if (typeof m.code !== 'string' || !Object.hasOwn(AUTHORIZE_CODES, m.code) || AUTHORIZE_CODES[m.code].outcome !== m.outcome || m.reason !== null) return null;
  if (m.correlationId !== null && !(typeof m.correlationId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(m.correlationId))) return null;
  if (m.elapsedMs !== null && !(Number.isInteger(m.elapsedMs) && m.elapsedMs >= 0 && m.elapsedMs <= 600000)) return null;
  return { outcome: m.outcome, code: m.code, reason: m.reason, correlationId: m.correlationId, elapsedMs: m.elapsedMs };
}

export function createBroker({ send, waitMs = 24000, maxPending = 8, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  const pending = new Map();      // id -> { resolve, timer }
  let nextId = 1;
  function ask(params, trace = null) {
    return new Promise((resolve) => {
      if (pending.size >= maxPending) { resolve(noDecision('busy')); return; }
      if (nextId > MAX_ID) { resolve(noDecision('unavailable')); return; }
      const id = nextId++;
      const timer = setTimeoutImpl(() => { if (pending.delete(id)) resolve(noDecision('timeout')); }, waitMs);
      timer?.unref?.();
      pending.set(id, { resolve, timer });
      let sent = false;
      try { sent = send({ type: 'authorize', id, trace: typeof trace === 'string' && /^[0-9a-f]{32}$/.test(trace) ? trace : null, params }) === true; } catch { sent = false; }
      if (!sent && pending.delete(id)) { clearTimeoutImpl(timer); resolve(noDecision('unavailable')); }
    });
  }
  function onMessage(m) {
    if (!isObj(m) || m.type !== 'authorize-result') return;
    const id = m.id;
    if (!Number.isInteger(id) || !pending.has(id)) return;       // unknown, already answered or timed out: dropped
    const p = pending.get(id);
    pending.delete(id); clearTimeoutImpl(p.timer);
    p.resolve(shapeOfResult(m) ?? noDecision('malformed'));
  }
  return { ask, onMessage, pendingCount: () => pending.size };
}
