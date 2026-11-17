// The decision card's data: one plain-language verdict for a run, plus the five things the audit has to say (the meeting agenda,
// step 7): which agent acted, on whose behalf, which tool or resource, which policy applied, and what was decided. A pure
// function of the run the server sent: it reads hops and tokens only and never decides anything itself.

export const NOT_REACHED = "not reached in this run";

const bodyOf = (hop) => hop?.response?.body;
const ran = (run, kind) => (run?.hops || []).find((h) => h.kind === kind && h.verdict !== "skip");
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
// The lab's lowercase ids for who refused, in words an audience reads.
const WHO = { authorize: "Agent Authorize", gateway: "the gateway", bff: "the BFF (the app's back end)" };

// A run whose tool call was answered by the lab's own tool server (the data says so: `answeredBy` on its hops, a fixed string from the server). Such a
// refusal is the lab's policy, not PingOne Authorize and not a gateway, and the card says so in the server's words.
const viaTools = (run) => run?.kind === "real" && (run?.hops || []).some((h) => h?.capability === "tools");
// A hold the tool server or the gateway answered with "needs a stronger authentication": the reply head says it (the server's fixed words).
const stepUpHold = (run) => run?.outcome === "REAL_HOLD" && /step-up/i.test(String(run?.reply?.approval?.head || ""));
const whoOf = (id) => (text(id) && Object.hasOwn(WHO, id) ? WHO[id] : text(id) || "the system that answered");

// The delegated token is the one that names an agent in act; the first token naming none is the person's own.
function actors(run) {
  const toks = (run?.tokens || []).map((t) => t?.claims).filter((c) => c && typeof c === "object");
  const delegated = [...toks].reverse().find((c) => c.act && typeof c.act === "object" && text(c.act.sub));
  const authz = ran(run, "authorize-decision")?.request?.body;
  const person = text(delegated?.sub) || text(authz?.subject) || text(toks[0]?.sub);
  const agent = text(delegated?.act?.sub) || text(authz?.context?.act?.sub);
  return { person, agent };
}

// The tool the model proposed; falls back to the action Authorize was asked about, then to the tool the MCP server ran.
function toolOf(run) {
  const plan = bodyOf(ran(run, "llm-plan"))?.tool_calls?.[0]?.name;
  return text(plan) || text(ran(run, "authorize-decision")?.request?.body?.action) || text(ran(run, "authorize-decision")?.request?.tool) || text(bodyOf(ran(run, "tool-dispatched"))?.result?.tool);
}

// Who decided and why, as the lab's own words from the hop that said it (never a rewrite of the reason).
function policyOf(run) {
  const az = ran(run, "authorize-decision");
  // The tool server's own rule: who decided is the hop's own `decision.by` ("lab policy (local), not PingOne Authorize"), the rule is in the audit trail it sent.
  if (az && viaTools(run) && text(az.decision?.by)) {
    const rule = text(az.response?.["x-gw-audit-trail"]?.rule);
    return { by: az.decision.by, reason: rule || text(az.note) || "the tool server's own rule", decision: text(az.decision?.outcome) };
  }
  const azBody = bodyOf(az);
  if (az && text(azBody?.reason)) return { by: WHO.authorize, reason: azBody.reason, decision: azBody.decision };
  const gw = bodyOf(ran(run, "gateway-check"));
  const failed = Array.isArray(gw?.checks) ? gw.checks.find((c) => c && c.ok === false) : null;
  if (failed) return { by: "the gateway", reason: text(failed.why) || `${failed.check} check failed`, decision: "DENY" };
  const refused = bodyOf(ran(run, "tool-refused"));
  if (refused && text(refused.reason)) return { by: whoOf(refused.refused_by), reason: refused.reason, decision: refused.outcome };
  if (gw && Array.isArray(gw.checks) && gw.checks.length) return { by: "the gateway", reason: `${gw.checks.map((c) => c.check).join(", ")} all valid`, decision: "PERMIT" };
  return null;
}

function verdictOf(outcome) {
  if (outcome === "PERMIT" || outcome === "DELEGATE_AND_EXECUTE" || outcome === "REAL_PERMIT") return "allowed";
  if (outcome.startsWith("DENY") || outcome === "PERMIT_THEN_DENY" || outcome === "REAL_DENY") return "denied";
  if (outcome === "STEP_UP" || outcome === "HITL_REQUIRED" || outcome === "CIBA" || outcome === "REAL_HOLD") return "escalated";
  // The approval receipt a retry carried was refused by the tool server: a refusal, never a pass (owner 2026-11-16).
  if (outcome === "REAL_RECEIPT_REJECTED") return "denied";
  return null;
}

// The four controls a call can end in, from "nobody is asked" to "refused". The strip names the CONTROL, not the kind of request: a run
// carries no read/write class, so none is invented here. Thresholds that pick a control are the lab's own (policy.js).
export const RISK_RUNGS = [
  { level: 1, control: "Proceeds automatically", word: "PERMIT" },
  { level: 2, control: "Second factor first", word: "STEP_UP" },
  { level: 3, control: "A person approves", word: "HITL_REQUIRED" },
  { level: 4, control: "Refused", word: "DENY" },
];

// Which rung of the strip a run landed on; null when the run made no decision (guided, identity-provider-only, not completed).
export function riskLevelOf(run) {
  const o = String(run?.outcome || "");
  if (run?.kind === "guided" || (run?.computed === false && !viaTools(run)) || run?.kind === "live") return null;
  const v = verdictOf(o);
  if (v === "allowed") return 1;
  if (v === "denied") return 4;
  if (v === "escalated") return o === "STEP_UP" || stepUpHold(run) ? 2 : 3;
  return null;
}

// When the agent's instructions steered it, the card says so: what it proposed against what the customer asked for.
function steerOf(run) {
  const s = run?.steered;
  if (!s || !s.proposed || !text(s.proposed.tool)) return null;
  const amount = typeof s.proposed.amount === "number" ? ` for ${s.proposed.amount}` : "";
  return `The agent's instructions steered it: it proposed ${s.proposed.tool}${amount} though the customer asked for ${text(s.asked?.tool) || "something else"}.`;
}

const WORD = { allowed: "ALLOWED", denied: "DENIED", escalated: "ESCALATED" };
const TONE = { allowed: "ok", denied: "bad", escalated: "warn" };

// Returns null while there is no run. Guided runs and the identity-provider-only Real check carry no decision of their own.
export function decisionOf(run) {
  if (!run || typeof run !== "object") return null;
  const outcome = String(run.outcome || "");
  // A Real run is read, not computed (the server sends computed:false for it), but it does carry a decision: only a guided page and an unlabelled run say "guided".
  if (run.kind === "guided" || (run.computed === false && !viaTools(run))) {
    return { verdict: "guided", word: "GUIDED", tone: "info", level: null, steer: null, reason: "A guided page: the lab shows the catalog's label and does not decide anything here.", fields: [] };
  }
  if (run.kind === "live") {
    return { verdict: "idp", word: "IDENTITY PROVIDER ONLY", tone: "info", level: null, steer: null, reason: "Identity provider only: two calls, nothing past the identity provider, so no tool call was decided.", fields: [] };
  }
  const { person, agent } = actors(run);
  // The gateway did not list the tool for this token, so the agent never called it. For a tier use case that is the standard tier: not a refusal of a call
  // (there was none) but a tool the user is never offered.
  if (outcome === "REAL_NOT_LISTED" && viaTools(run)) {
    // The groups claim is UNVERIFIED in a real exchanged token: when the delegated token had none, the tool server could not tell the tier, so nothing here is a tier decision.
    if (run.groupsClaim === "absent") {
      return {
        verdict: "not-offered", word: "NOT OFFERED", tone: "warn", level: null, steer: null,
        reason: "The tool server did not offer the tool, but no tier decision can be read from that: the delegated token has no groups claim (UNVERIFIED that PingOne puts it there), so the tool server could not see the tier group. Check the groups attribute of the tools resource in PingOne.",
        fields: [
          { key: "agent", label: "Which agent acted", value: agent || NOT_REACHED },
          { key: "principal", label: "On whose behalf", value: person || NOT_REACHED },
          { key: "tool", label: "Which tool or resource", value: "not offered, so never called" },
          { key: "policy", label: "Which policy applied", value: "the tool server: its tier rule could not be applied, the groups claim is ABSENT" },
          { key: "decision", label: "Decision", value: "no tier decision (groups claim absent)" },
        ],
      };
    }
    return {
      verdict: "not-offered", word: "NOT OFFERED", tone: "warn", level: null, steer: null,
      reason: "The tool server did not offer the tool to this user, so the agent never called it. Its own rule (lab policy, not PingOne Authorize) decides which tools a user is offered.",
      fields: [
        { key: "agent", label: "Which agent acted", value: agent || NOT_REACHED },
        { key: "principal", label: "On whose behalf", value: person || NOT_REACHED },
        { key: "tool", label: "Which tool or resource", value: "not offered, so never called" },
        { key: "policy", label: "Which policy applied", value: "the tool server: the tool is not in its tools/list for this token" },
        { key: "decision", label: "Decision", value: outcome },
      ],
    };
  }
  if (outcome === "REAL_NOT_LISTED") {
    return {
      verdict: "not-offered", word: "NOT OFFERED", tone: "warn", level: null, steer: null,
      reason: "The gateway did not offer the tool to this user, so the agent never called it. A tier or policy at the gateway decides which tools a user is offered.",
      fields: [
        { key: "agent", label: "Which agent acted", value: agent || NOT_REACHED },
        { key: "principal", label: "On whose behalf", value: person || NOT_REACHED },
        { key: "tool", label: "Which tool or resource", value: "not offered, so never called" },
        { key: "policy", label: "Which policy applied", value: "the gateway: the tool is not in its tools/list for this token" },
        { key: "decision", label: "Decision", value: outcome },
      ],
    };
  }
  // UC24's probe: the protected tool should have said 401 to a call with no token and did not. A finding, not a decision.
  if (outcome === "REAL_NOT_REFUSED") {
    return {
      verdict: "finding", word: "FINDING", tone: "bad", level: null, steer: null,
      reason: "The protected tool answered without a token. A call with no token should be refused.",
      fields: [
        { key: "agent", label: "Which agent acted", value: NOT_REACHED },
        { key: "principal", label: "On whose behalf", value: NOT_REACHED },
        { key: "tool", label: "Which tool or resource", value: toolOf(run) || NOT_REACHED },
        { key: "policy", label: "Which policy applied", value: NOT_REACHED },
        { key: "decision", label: "Decision", value: outcome },
      ],
    };
  }
  const verdict = verdictOf(outcome);
  const policy = policyOf(run);
  const tool = toolOf(run);
  const held = bodyOf(ran(run, "tool-held")) || bodyOf(ran(run, "step-up"));
  const refusedBy = policy?.by;
  const why = policy?.reason;

  let word, tone, reason;
  if (verdict === "allowed") {
    word = WORD.allowed; tone = TONE.allowed;
    reason = `Allowed${why ? `: ${why}` : ""}. The tool ran.`;
  } else if (verdict === "denied") {
    word = WORD.denied; tone = TONE.denied;
    reason = outcome === "REAL_RECEIPT_REJECTED" ? "The approval receipt was refused. Nothing was dispatched to the tool."
      : `Refused${refusedBy ? ` by ${refusedBy}` : ""}${why ? `: ${why}` : ""}. Nothing was dispatched to the tool.`;
  } else if (verdict === "escalated") {
    word = WORD.escalated; tone = TONE.escalated;
    const needs = outcome === "STEP_UP" || stepUpHold(run) ? "a second factor" : "a person";
    reason = `Held${why ? `: ${why}` : ""}. The write waits for ${held?.needs ? held.needs : needs}; it has not run.`;
  } else {
    word = "NOT COMPLETED"; tone = outcome.startsWith("REAL_") || outcome.startsWith("LIVE_") ? "bad" : "info";
    reason = `The run ended ${outcome || "without an outcome"}. The sequence shows where.`;
  }
  const decided = outcome ? (policy?.decision && policy.decision !== outcome ? `${outcome} (${policy.decision})` : outcome) : NOT_REACHED;
  return {
    verdict: verdict || "other", word, tone, level: riskLevelOf(run), steer: steerOf(run), reason,
    fields: [
      { key: "agent", label: "Which agent acted", value: agent || NOT_REACHED },
      { key: "principal", label: "On whose behalf", value: person || NOT_REACHED },
      { key: "tool", label: "Which tool or resource", value: tool || NOT_REACHED },
      { key: "policy", label: "Which policy applied", value: policy ? `${policy.by}: ${policy.reason}` : NOT_REACHED },
      { key: "decision", label: "Decision", value: decided },
    ],
  };
}

// The rows of a side-by-side comparison of two runs: the verdict, then the five audit facts. A row is `differs` when the two sides say
// different things, so the eye lands on what changed. Returns [] unless both runs exist.
export function compareRows(a, b) {
  const da = decisionOf(a), db = decisionOf(b);
  if (!da || !db) return [];
  const rows = [{ key: "verdict", label: "Verdict", left: da.word, right: db.word }];
  for (const f of da.fields) rows.push({ key: f.key, label: f.label, left: f.value, right: db.fields.find((x) => x.key === f.key)?.value ?? NOT_REACHED });
  return rows.map((r) => ({ ...r, differs: r.left !== r.right }));
}
