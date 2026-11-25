// Rule 27: this lab's side of the shared run-observability panel. The vendored collector (runObservability.js) is never edited
// here; this is the one file that maps this lab's decisions onto the six layers. This lab reads no logs, so it vendors the
// core only: no readers file and no reader setting anywhere.
//
// What a run is here. ONE run of a use case (POST /run/:id): the mock engine (flow.js runUseCase) computed an ordered
// list of hops once — sign-in, the agent's LLM plan, the token chain, the Authorize decision, the gateway check, the
// tool call and its back end, or a refusal / a held call. Every hop is a row; nothing is re-run or re-computed.
//
// Which layer holds what. A hop's `from`/`to` name the product that spoke, and its `verdict` is the engine's own
// outcome word: ok (allowed), deny (refused), obligation / held (information: the call pauses for a human — a pause
// is not a verdict on the call), skip (information: AI-DEMO2 lists the step the run did not take). The two policy
// points are the Authorize decision hops (authorize-decision, intent-binding-verified, a2a-mismatch-probe) — Authorize
// layer, allowed or refused — and the gateway's answer hop (privilege-gateway-leg: information; the lab computes no
// checks on it, so it never claims a Privilege policy verdict). Sign-in, the LLM plan and the token chain are
// information in the Person / Agent / Privilege layers. The tool call and its back end are the Resource server layer.
//
// Stdout line: `<iso> appfire-agent-governance-lab decision step=<step> layer=<layer> actor=<who> result=... run=<id>`,
// one per decision row. The owner granted this lab the 2026-11-16 wording exception: its rows may say mock, real and
// simulated. Every value still passes the masker and the line sanitiser.
import crypto from 'node:crypto';
import { createMasker, createRunObservability, LAYERS } from './runObservability.js';

export const SERVICE = 'appfire-agent-governance-lab';
export const KEEP_RUNS = 12; // closed runs kept: the workspace keeps its own run list; the panel shows the last few
export const NO_RUN_BEGAN = 'This request began no run, so nothing was recorded.';
export const RECORDER_DOWN = 'The lab could not keep a record of this run (the server log says why).';
export const NO_LONGER_KEPT = 'That run is no longer kept: the lab keeps the last few runs, and Reset clears them.';

export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
const MATCHER_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient/gi;
const { mask } = createMasker();
const field = (v) => lineValue(mask(String(v ?? ''))).replace(MATCHER_WORDS, '_');
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };

export function reportFailure(where, err) {
  process.stderr.write(`[${SERVICE}] run observability: ${lineValue(where, 40)} ${lineValue(err?.code || err?.name || 'error', 40)} (the error's text is not logged)\n`);
}
export function safely(where, fn) {
  try { return fn(); } catch (err) { reportFailure(where, err); return undefined; }
}

const PRODUCT = {
  person: 'lab mock sign-in (IdP)', agent: 'lab mock agent + LLM', privilege: 'lab mock token chain',
  authorize: 'lab mock Authorize policy', gateway: 'lab mock Privilege gateway', resource: 'lab mock MCP tool + airline API',
};

// The layer map for a hop. KEY hops first (the two policy points and the gateway answer), then by the hop's `from` side.
const KEY_LAYER = {
  'authorize-decision': ['authorize', 'pdp-decision'],
  'intent-binding-verified': ['authorize', 'pdp-decision'],
  'a2a-mismatch-probe': ['authorize', 'pdp-decision'],
  'privilege-gateway-leg': ['gateway', 'gateway-answer'],
  'sign-in': ['person', 'sign-in'],
  consent: ['person', 'consent'],
  'llm-plan': ['agent', 'llm-plan'],
  prompt: ['agent', 'prompt'],
  'personal-agent-lookup': ['agent', 'agent-registry'],
  'actor-token': ['privilege', 'token-chain'],
  'token-exchange': ['privilege', 'token-chain'],
  'id-jag-issued': ['privilege', 'token-chain'],
  'id-jag-redeemed': ['privilege', 'token-chain'],
  'verified-trust-issuance': ['privilege', 'token-chain'],
  'vault-key-inject': ['resource', 'credential-swap'],
  'api-key-swap': ['resource', 'credential-swap'],
  'tool-dispatched': ['resource', 'tool-call'],
  'api-call': ['resource', 'tool-call'],
  'tools-list': ['resource', 'tool-call'],
  step_up: ['gateway', 'obligation'],
  'tool-held': ['resource', 'held'],
  'tool-refused': ['resource', 'refused-hop'],
  'ciba-authorize': ['person', 'ciba'],
  'ciba-poll': ['person', 'ciba'],
  'hitl-receipt': ['gateway', 'obligation'],
  'exchange-skipped': ['privilege', 'token-chain'],
  guided: ['agent', 'guided-open'],
};
const FROM_LAYER = {
  agent: ['agent', 'agent-step'],
  browser: ['person', 'sign-in'],
  privilege: ['gateway', 'gateway-answer'],
  mcp: ['resource', 'tool-call'],
};
const layerOf = (h) => KEY_LAYER[h.kind]?.[0] ?? FROM_LAYER[h.from]?.[0] ?? 'gateway';
const stepOf = (h) => KEY_LAYER[h.kind]?.[1] ?? lineValue(String(h.kind ?? 'hop'), 40);

// The hop's outcome word -> (outcome, note). obligation and held are a pause for a human: information, never a verdict.
const OUTCOME_OF = {
  ok: ['allowed'],
  deny: ['refused'],
  obligation: ['info', 'The call pauses for an obligation (step-up / HITL / CIBA): a pause for a human, not a verdict on the call.'],
  held: ['info', 'The call is held until a person approves: a pause for a human, not a verdict on the call.'],
  skip: ['info', 'AI-DEMO2 lists this step; this run did not take it. Information, not a decision.'],
};
const outcomeOf = (h) => OUTCOME_OF[h.verdict] ?? ['info'];

// The chain view's keys (SPEC-chain-view-2026-11-24), only where a row already shows the fact: the person from the
// user token's sub, the agent from the exchanged token's act chain or the agent registry hop, scopes from the
// exchanged token's scope claim. The policy node: the Authorize decision hop's outcome.
function chainOf(run) {
  const hops = Array.isArray(run?.hops) ? run.hops : [];
  const tokens = Array.isArray(run?.tokens) ? run.tokens : [];
  const user = tokens.find((t) => t.label === 'user token')?.claims?.sub;
  const exch = tokens.find((t) => t.label === 'exchanged token')?.claims;
  const agent = exch?.act?.sub ?? null;
  const scopes = typeof exch?.scope === 'string' ? exch.scope.split(/\s+/).filter(Boolean).slice(0, 20) : [];
  const dec = hops.find((h) => h.kind === 'authorize-decision');
  const decision = dec?.detail?.decision?.outcome ?? dec?.response?.body?.decision;
  return {
    ...(user ? { user } : {}),
    ...(agent ? { agent } : {}),
    ...(scopes.length ? { scopes } : {}),
    ...(decision ? { policy: { product: PRODUCT.authorize, decision: decision === 'PERMIT' || decision === 'CONSTRAINED' || decision === 'DELEGATE_AND_EXECUTE' ? 'permit' : decision === 'DENY' || decision === 'DENY_401' || decision === 'DENY_403' || decision === 'DENY_429' || decision === 'DENY_503' ? 'deny' : 'obligation', ...(run.useCase?.id ? { id: run.useCase.id } : {}) } } : {}),
  };
}

// One run's hops -> decision events. A guided run has one hop and no policy decision: it is information.
export function runEvents(run) {
  if (!run || !Array.isArray(run.hops)) return [];
  const chain = chainOf(run);
  const guided = run.kind === 'guided';
  const evs = [];
  for (const h of run.hops) {
    let [outcome, note] = guided
      ? ['info', "A guided use case: the product shows its own page; the lab opens it and does not recompute the outcome (the catalog label)."]
      : outcomeOf(h);
    evs.push({
      layer: layerOf(h), product: PRODUCT[layerOf(h)], step: stepOf(h), outcome,
      who: chain.agent ?? chain.user ?? 'the caller',
      message: `${h.label || h.kind}: ${h.from} -> ${h.to}${h.note ? ` — ${h.note}` : ''}${note ? ` ${note}` : ''}`.slice(0, 290),
      detail: {
        hop: h.kind, from: h.from, to: h.to, verdict: h.verdict ?? null, status: h.response?.status ?? null,
        mock: h.mock === true, hopN: h.n, ...chain,
      },
    });
  }
  return evs;
}

// ---- Stdout lines ------------------------------------------------------------------------------------------------------------------------------------
export function decisionLine(ev, runId) {
  return `${ev.at} ${SERVICE} decision step=${lineValue(ev.step)} layer=${lineValue(ev.layer, 12)} actor=${field(ev.who)} result=${RESULT[ev.outcome] ?? 'unclear'} run=${lineValue(runId)}`;
}

// ---- The run log: bounded. Mock runs and Real runs are recorded the same way (a Real run's rows say which hops were MOCK-labelled). ----
export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = Date.now } = {}) {
  const part = crypto.randomBytes(3).toString('hex');
  let made = 0;
  const kept = [];
  const prune = () => { while (kept.length > KEEP_RUNS) kept.shift(); };
  const line = (ev, id) => safely('line', () => write(decisionLine(ev, id)));

  return {
    // One run = one run. `build` may throw: then nothing is stored and the answer carries the baseline's runNote.
    mock(build, { source = 'mock' } = {}) {
      return safely('mock-run', () => {
        const events = build();
        const at = new Date(clock()).toISOString();
        const run = { id: `run-${part}-${++made}`, source, startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false };
        kept.push(run); prune();
        for (const ev of run.events) line(ev, run.id);
        return run.id;
      }) ?? null;
    },
    get(id) { return kept.find((r) => r.id === id) || null; },
    clear() { kept.length = 0; },
    size() { return kept.length; },
  };
}
export const runField = (id) => (id ? { run: { id } } : { run: null, runNote: RECORDER_DOWN });
export const NO_RUN = Object.freeze({ run: null, runNote: NO_RUN_BEGAN });

// ---- The record ----------------------------------------------------------------------------------------------------------------------------------------
const WHY = {
  person: 'The Person layer holds this run\'s sign-in and consent hops (mock): the lab\'s own stand-in IdP, read from the run\'s hops.',
  agent: 'The Agent layer holds the agent\'s LLM plan and registry hops: what the mock agent planned, read from the run\'s hops.',
  authorize: 'This run made no Authorize decision (a guided run, or the chain stopped before the PDP).',
  privilege: 'This run built no token chain (no exchange, no ID-JAG): the hops name the token steps that ran.',
  gateway: 'This run\'s chain never reached the Privilege gateway leg.',
  resource: 'The call never reached the mock MCP tool or the airline API (the chain was stopped or held first).',
};

export async function recordOf(run, { clock = Date.now } = {}) {
  return createRunObservability({ clock }).collectRun({
    runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: run.source,
    layers: LAYERS.map((layer) => {
      const own = run.events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: { ...e.detail, eventSeq: e.seq } }));
      return { layer, products: [], reason: WHY[layer], simulated: own };
    }),
  });
}
