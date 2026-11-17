// The lab's own approval service: challenges bound to (sub, tool, arguments), answered by a person, spent once. In memory only.
import { randomUUID } from 'node:crypto';
import { sha256hex, stableStringify } from './util.js';

export const CONTROL_FIELD = '_hitl_challenge_id';

// sha256 hex of the key-sorted JSON of the arguments WITHOUT the control field. Key order does not matter.
export function argsDigest(args) {
  const copy = {};
  if (args && typeof args === 'object' && !Array.isArray(args)) for (const k of Object.keys(args)) if (k !== CONTROL_FIELD) copy[k] = args[k];
  return sha256hex(stableStringify(copy));
}

export const MAX_PENDING_PER_SUB = 5;

export function createHitl({ now = Date.now, ttlMs = 300_000, max = 200, perSub = MAX_PENDING_PER_SUB, newId = randomUUID } = {}) {
  const store = new Map();
  const statusOf = (c) => (c.status === 'pending' && now() >= c.expiresAtMs ? 'expired' : c.status);
  const expired = (c) => now() >= c.expiresAtMs;
  const iso = (ms) => new Date(ms).toISOString();

  function evict() {
    for (const [id, c] of store) if (statusOf(c) !== 'pending') { store.delete(id); return true; }   // oldest decided or expired one first
    return false;
  }

  const shown = (c) => ({ ok: true, id: c.id, status: 'pending', expiresAt: iso(c.expiresAtMs), ttlSeconds: Math.round(ttlMs / 1000) });

  return {
    size: () => store.size,
    create({ sub, tool, argsDigest: digest, amount = null }) {
      // A held call that is retried with the same arguments gets the same pending challenge (idempotent), and one caller can keep only `perSub` pending
      // challenges: the oldest of their own is dropped first, so one token holder can never fill the store for everyone else.
      const mine = [];
      for (const c of store.values()) {
        if (c.sub !== sub || statusOf(c) !== 'pending') continue;
        if (c.tool === tool && c.argsDigest === digest) return shown(c);
        mine.push(c);
      }
      if (mine.length >= perSub) store.delete(mine[0].id);
      if (store.size >= max && !evict()) return { ok: false, reason: 'capacity' };
      const id = newId();
      const createdAtMs = now();
      const c = { id, status: 'pending', sub, tool, argsDigest: digest, amount, createdAtMs, expiresAtMs: createdAtMs + ttlMs, respondedBy: null, respondedAtMs: null };
      store.set(id, c);
      return { ok: true, id, status: 'pending', expiresAt: iso(c.expiresAtMs), ttlSeconds: Math.round(ttlMs / 1000) };
    },
    respond(id, { decision, respondedBy }) {
      const c = store.get(id);
      if (!c) return { ok: false, code: 'unknown_challenge' };
      if (c.status === 'pending' && expired(c)) return { ok: false, code: 'expired' };
      if (c.status !== 'pending') return { ok: false, code: 'already_answered', status: statusOf(c) };
      c.status = decision === 'approved' ? 'approved' : 'denied';
      c.respondedBy = respondedBy;
      c.respondedAtMs = now();
      return { ok: true, id, status: c.status, decision: c.status, respondedAt: iso(c.respondedAtMs) };
    },
    // A valid verify spends the challenge. A failed one changes nothing.
    verify(id, { sub, tool, argsDigest: digest }) {
      const c = typeof id === 'string' ? store.get(id) : undefined;
      if (!c) return { valid: false, reason: 'receipt_unknown' };
      if (c.sub !== sub || c.tool !== tool || c.argsDigest !== digest) return { valid: false, reason: 'receipt_binding_mismatch' };
      if (c.status === 'consumed') return { valid: false, reason: 'receipt_used' };
      if (expired(c)) return { valid: false, reason: 'receipt_expired' };
      if (c.status === 'pending') return { valid: false, reason: 'receipt_pending' };
      if (c.status === 'denied') return { valid: false, reason: 'receipt_denied' };
      c.status = 'consumed';
      return { valid: true, id: c.id, consumed: true };
    },
    get(id) {
      const c = typeof id === 'string' ? store.get(id) : undefined;
      if (!c) return { ok: false, code: 'unknown_challenge' };
      return { ok: true, id: c.id, status: statusOf(c), tool: c.tool, amount: c.amount, createdAt: iso(c.createdAtMs), expiresAt: iso(c.expiresAtMs) };
    },
  };
}
