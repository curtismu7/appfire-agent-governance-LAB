// The approval service (owner request 2026-11-13: "take AI-DEMO2's mock phone and make it a reusable service").
// One module owns every human-approval session, in both modes:
//
//   MOCK path:  start() mints a lab challenge (a lab id, a mock phone answer decides it) — the same shape AI-DEMO2's
//               /api/consent-mock-phone gives the phone component: start / status / decision, pending → approved | denied.
//   REAL path:  start() records a REAL challenge the Agent Gateway minted (its 428 body carries challengeId);
//               decide('approved') calls the SE HITL service's POST /challenges/:id/respond with the internal secret
//               (write-only: held in settings, never sent to the page, never logged) and returns the receipt id, which
//               real.js sends back on the retry as _hitl_challenge_id. The gateway verifies the receipt with the same
//               service; a denied or failed verify stays refused (fail closed, never an implicit approval).
//
// The UI contract (what a reusable phone component needs): start() → { id, state: 'pending', tool, amount, description,
// challengeId? }, status(id), decide(id, approved) → { state: 'approved' | 'denied', ... }. Ids are lab-minted random
// hex (never the gateway's id, which stays server-side). Sessions are per workspace and capped; expired ones answer
// 'denied' semantics (fail closed).
import { randomBytes } from 'node:crypto';

const TTL_MS = 5 * 60 * 1000; // a challenge nobody answers in five minutes is expired (fail closed)
const CAP = 50; // per workspace; the oldest expired/decided session is dropped first

const hex = (n) => randomBytes(n).toString('hex');
const now = () => Date.now();

export function createApprovals({ hitlUrl = '', hitlSecret = '', fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  // workspaces: Map<workspaceId, Map<sessionId, session>>
  const workspaces = new Map();
  let inFlight = 0;

  const storeOf = (ws) => {
    if (!workspaces.has(ws)) workspaces.set(ws, new Map());
    const store = workspaces.get(ws);
    if (store.size >= CAP) {
      const oldest = [...store.entries()].filter(([, s]) => s.state !== 'pending').sort((a, b) => a[1].at - b[1].at)[0]
        ?? [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) store.delete(oldest[0]);
    }
    return store;
  };

  const view = (s) => ({
    id: s.id, state: s.state, kind: s.kind, tool: s.tool, amount: s.amount,
    description: s.description, challengeId: undefined, // the gateway's id never leaves the server
    createdAt: new Date(s.at).toISOString(), expiresAt: new Date(s.at + TTL_MS).toISOString(),
  });

  // start({ workspace, kind: 'mock' | 'real', tool, amount, description, challengeId? })
  // kind 'real' REQUIRES a challengeId (the gateway minted it): without one there is nothing to approve and nothing
  // to retry — the callers refuse before this. kind 'mock' mints a lab-only challenge.
  function start({ workspace, kind = 'mock', tool, amount = null, description = '', challengeId = null }) {
    if (kind === 'real' && !challengeId) throw new Error('a real approval needs the gateway challengeId');
    const id = hex(12);
    const session = { id, kind, tool: String(tool ?? ''), amount, description: String(description ?? ''), challengeId: kind === 'real' ? String(challengeId) : null, state: 'pending', at: now(), workspace };
    storeOf(workspace).set(id, session);
    return view(session);
  }

  function status(workspace, id) {
    const s = storeOf(workspace).get(String(id ?? ''));
    if (!s) return null;
    if (s.state === 'pending' && now() - s.at > TTL_MS) { s.state = 'expired'; }
    return view(s);
  }

  // decide(workspace, id, approved: boolean) → view with state approved | denied | expired.
  // REAL path: on approved, asks the SE HITL service to record the human's answer. Its HTTP result decides the lab's
  // state: the service may refuse (expired, already answered, unknown id) — a failed record is NOT an approval.
  async function decide(workspace, id, approved) {
    const s = storeOf(workspace).get(String(id ?? ''));
    if (!s) return null;
    if (s.state !== 'pending') return view(s);
    if (now() - s.at > TTL_MS) { s.state = 'expired'; return view(s); }
    if (s.kind === 'mock') { s.state = approved ? 'approved' : 'denied'; return view(s); }
    // REAL: record the answer with the SE HITL service (the gateway's verify runs again on the retry).
    if (!hitlUrl) { s.state = 'expired'; return { ...view(s), error: 'the HITL service is not configured' }; }
    inFlight += 1;
    try {
      const r = await fetchImpl(`${hitlUrl.replace(/\/$/, '')}/challenges/${encodeURIComponent(s.challengeId)}/respond`, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', ...(hitlSecret ? { 'x-hitl-internal-secret': hitlSecret } : {}) },
        body: JSON.stringify({ decision: approved ? 'approved' : 'denied', respondedBy: 'appfire-agent-governance-lab mock phone' }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && (body.status === 'approved' || body.decision === 'approved')) s.state = 'approved';
      else if (r.ok && (body.status === 'denied' || body.decision === 'denied')) s.state = 'denied';
      else s.state = 'expired';
      if (r.ok) s.receipt = s.challengeId; // the id real.js echoes on the retry (the gateway re-verifies server-side)
      else s.error = `the HITL service answered HTTP ${r.status}`;
      return { ...view(s), ...(s.error ? { error: s.error } : {}) };
    } catch {
      s.state = 'expired';
      return { ...view(s), error: 'the HITL service did not answer; the approval was not recorded (fail closed)' };
    } finally { inFlight -= 1; }
  }

  // The receipt for a decided REAL session (undefined until an approved decide()).
  const receiptOf = (workspace, id) => storeOf(workspace)?.get(String(id ?? ''))?.receipt;
  const pendingCount = () => inFlight;
  const reset = (workspace) => { workspaces.delete(workspace); };

  return { start, status, decide, receiptOf, reset, pendingCount };
}
