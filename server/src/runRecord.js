// "What each layer logged for this run" for the lab's own (engine) runs. The engine computes every hop once; this module maps those hops to the six
// layers (the core, runObservability.js, builds the record), keeps the record per workspace, and writes one stdout line per policy decision.
// Times: every hop of a run is computed in one call, so every row carries the time the engine finished the run. Rows that share a time are listed
// by layer, not by the order the engine ran them (the core orders ties by layer).
// A Real run is not recorded here (no record is built for it): the page says so.
import crypto from 'node:crypto';
import { createRunObservability, LAYERS } from './runObservability.js';

export const RUN_ID = /^run-[0-9a-z]{1,12}-[0-9a-f]{8}$/;
export const PRODUCT = 'lab engine';
export const MAX_PER_WORKSPACE = 50;

// The hop kinds the engine produces, each under one layer. A kind not listed here is not recorded (the run answers without a record).
const KIND_LAYER = {
  'sign-in': 'person', website: 'person', consent: 'person', 'ciba-authorize': 'person', 'ciba-poll': 'person', 'hitl-receipt': 'person',
  'step-up': 'person', 'personal-agent-lookup': 'person', guided: 'person',
  'llm-plan': 'agent', prompt: 'agent', 'agent-reply': 'agent', 'agent-receive': 'agent', 'actor-token': 'agent', 'id-jag-issued': 'agent',
  'id-jag-redeemed': 'agent', 'exchange-skipped': 'agent', 'enterprise-managed-mode': 'agent', 'a2a-protocol-message': 'agent',
  'a2a-protocol-bearer': 'agent', 'a2a-mismatch-probe': 'agent', 'a2a-agent-card': 'agent',
  'authorize-decision': 'authorize', 'verified-trust-issuance': 'authorize', 'sim-rar-armed': 'authorize', 'intent-binding-verified': 'authorize',
  'privilege-gateway-leg': 'privilege',
  'tools-list': 'gateway', 'tool-refused': 'gateway', 'tool-held': 'gateway', 'tool-dispatched': 'gateway', 'api-key-swap': 'gateway',
  'credential-swap': 'gateway', 'vault-key-inject': 'gateway',
  'api-call': 'resource', 'database-query': 'resource',
  'tools-list-challenge': 'gateway', 'tools-call-challenge': 'gateway', 'gateway-check': 'gateway',
  'token-exchange': 'agent', 'a2a-exchange-1': 'agent', 'a2a-exchange-2': 'agent',
};

// Why a layer has no row in a run (the core shows it as not-logged with this reason).
const NOT_RUN = {
  person: 'This run had no sign-in, consent or hold step.',
  agent: 'This run made no agent step (no plan, prompt or token exchange).',
  authorize: 'This run made no Authorize decision.',
  privilege: 'This run made no Privilege gateway call.',
  gateway: 'This run reached no gateway hop.',
  resource: 'This run reached no resource server hop.',
};

// Only these outcomes are policy decisions (one stdout line each): the layer's own decision is allowed or refused; the lab's own rule stop is blocked.
export const DECISION_STEPS = [
  { step: 'authorize-policy', layer: 'authorize' },
  { step: 'gateway-policy', layer: 'gateway' },
  { step: 'privilege-policy', layer: 'privilege' },
  { step: 'lab-stop', layer: null },
];
// The shared classify() and the stdout vocabulary: a decision line may not carry any of these words (a test checks every line).
export const MATCHER_WORDS = ['refused', 'denied', 'rejected', 'forbidden', 'failed', 'invalid', 'expired', 'mismatch', 'token', 'audience', 'scope', 'served'];

// Outcome of one hop. Only a policy point's decision is allowed or refused. A fare rule the lab runs itself is the lab's own stop when it denies.
function outcomeOf(h, run) {
  if (h.kind === 'tool-dispatched') return h.verdict === 'deny' ? 'refused' : 'allowed';
  if (h.kind === 'tool-refused') return 'refused';
  if (h.kind === 'authorize-decision') {
    if (h.verdict === 'deny') return run.fareRule ? 'blocked' : 'refused';
    if (h.verdict === 'ok') return run.fareRule ? 'info' : 'allowed';
  }
  return 'info';
}

const clean = (v) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]/g, '_').slice(0, 80);

// One stdout line: `<iso> appfire-agent-governance decision step=<s> actor=<a> result=passed|stopped run=<id>`. Every value is reduced to
// [A-Za-z0-9._:/@-], so no value can add a key=value or a second line.
export function decisionLine({ at, step, actor, result, runId }) {
  return `${clean(at)} appfire-agent-governance decision step=${clean(step)} actor=${clean(actor)} result=${clean(result)} run=${clean(runId)}`;
}

// The layer of one engine hop, or known: false.
export function layerOfHop(h) {
  const layer = Object.hasOwn(KIND_LAYER, h?.kind) ? KIND_LAYER[h.kind] : null;
  return { known: layer !== null, layer };
}

const newRunId = (nowMs) => `run-${Math.max(0, Math.floor(nowMs)).toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

const defaultWriter = (line) => { process.stdout.write(`${line}\n`); };

// The lab's rows per layer, and the decisions in the order the engine ran them. Throws (an unmapped hop) rather than guessing a layer.
export function rowsOf(run, at) {
  const iso = new Date(at).toISOString();
  const rows = Object.fromEntries(LAYERS.map((l) => [l, []]));
  const decisions = [];
  for (const h of run.hops || []) {
    if (h.verdict === 'skip') continue; // a step the engine did not run
    const { known, layer } = layerOfHop(h);
    if (!known) { const e = new Error(`unmapped hop kind ${clean(h.kind)}`); e.code = 'unmapped_hop'; throw e; }
    const row = { at: iso, outcome: outcomeOf(h, run), message: `${h.n}. ${String(h.label ?? h.kind).slice(0, 200)}`, product: PRODUCT, origin: 'simulated' };
    rows[layer].push(row);
    if (row.outcome === 'allowed' || row.outcome === 'refused' || row.outcome === 'blocked') decisions.push({ layer, outcome: row.outcome });
  }
  return { rows, decisions };
}

export function createRunRecords({ max = MAX_PER_WORKSPACE, writer = defaultWriter, clock = Date.now, log = (m) => process.stderr.write(`${m}\n`), core = createRunObservability() } = {}) {
  const store = new Map(); // workspace -> [{ runId, record }], oldest first

  // Records the run: id first, then the record, then one line per decision (each line in its own try). Returns { runId, record } or null.
  async function record(ws, run, { uc } = {}) {
    const at = clock();
    const runId = newRunId(at);
    let decisions;
    let record;
    try {
      const built = rowsOf(run, at);
      decisions = built.decisions;
      const layers = LAYERS.map((layer) => ({ layer, simulated: built.rows[layer], ...(built.rows[layer].length ? {} : { reason: NOT_RUN[layer] }) }));
      record = await core.collectRun({ runId, startedAt: at, endedAt: at, layers, source: 'mock' });
    } catch (e) {
      log(`run-observability: not recorded (${typeof e?.code === 'string' ? e.code : 'error'})`);
      return null;
    }
    const list = store.get(ws) || [];
    list.push({ runId, record });
    while (list.length > max) list.shift(); // oldest first: the newest is last, so it is never the one dropped
    store.set(ws, list);
    const actor = uc?.id ?? 'run';
    const iso = new Date(at).toISOString();
    for (const d of decisions) {
      const step = d.outcome === 'blocked' ? 'lab-stop' : DECISION_STEPS.find((x) => x.layer === d.layer).step;
      const result = d.outcome === 'allowed' ? 'passed' : 'stopped';
      try { writer(decisionLine({ at: iso, step, actor, result, runId })); } catch (e) {
        log(`run-observability: a stdout line was not written (${typeof e?.code === 'string' ? e.code : 'error'})`);
      }
    }
    return { runId, record };
  }

  function get(ws, runId) {
    const hit = (store.get(ws) || []).find((x) => x.runId === runId);
    return hit ? hit.record : null;
  }

  function clear(ws) { store.delete(ws); }

  return { record, get, clear };
}
