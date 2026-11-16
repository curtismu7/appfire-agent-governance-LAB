// The decision card's data: one plain-language verdict for a run, plus the five things the audit has to say (the meeting agenda,
// step 7): which agent acted, on whose behalf, which tool or resource, which policy applied, and what was decided. A pure
// function of the run the server sent: it reads hops and tokens only and never decides anything itself.

export const NOT_REACHED = "not reached in this run";

const bodyOf = (hop) => hop?.response?.body;
const ran = (run, kind) => (run?.hops || []).find((h) => h.kind === kind && h.verdict !== "skip");
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
// The lab's lowercase ids for who refused, in words an audience reads.
const WHO = { authorize: "Agent Authorize", gateway: "the gateway", bff: "the BFF (the app's back end)" };
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
  return text(plan) || text(ran(run, "authorize-decision")?.request?.body?.action) || text(bodyOf(ran(run, "tool-dispatched"))?.result?.tool);
}

// Who decided and why, as the lab's own words from the hop that said it (never a rewrite of the reason).
function policyOf(run) {
  const az = ran(run, "authorize-decision");
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
  return null;
}

const WORD = { allowed: "ALLOWED", denied: "DENIED", escalated: "ESCALATED" };
const TONE = { allowed: "ok", denied: "bad", escalated: "warn" };

// Returns null while there is no run. Guided runs and the identity-provider-only Real check carry no decision of their own.
export function decisionOf(run) {
  if (!run || typeof run !== "object") return null;
  const outcome = String(run.outcome || "");
  if (run.kind === "guided" || run.computed === false) {
    return { verdict: "guided", word: "GUIDED", tone: "info", reason: "A guided page: the lab shows the catalog's label and does not decide anything here.", fields: [] };
  }
  if (run.kind === "live") {
    return { verdict: "idp", word: "IDENTITY PROVIDER ONLY", tone: "info", reason: "Real, identity provider only: two calls, nothing past the identity provider, so no tool call was decided.", fields: [] };
  }
  const verdict = verdictOf(outcome);
  const { person, agent } = actors(run);
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
    reason = `Refused${refusedBy ? ` by ${refusedBy}` : ""}${why ? `: ${why}` : ""}. Nothing was dispatched to the tool.`;
  } else if (verdict === "escalated") {
    word = WORD.escalated; tone = TONE.escalated;
    const needs = outcome === "STEP_UP" ? "a second factor" : "a person";
    reason = `Held${why ? `: ${why}` : ""}. The write waits for ${held?.needs ? held.needs : needs}; it has not run.`;
  } else {
    word = "NOT COMPLETED"; tone = outcome.startsWith("REAL_") || outcome.startsWith("LIVE_") ? "bad" : "info";
    reason = `The run ended ${outcome || "without an outcome"}. The sequence shows where.`;
  }
  const decided = outcome ? (policy?.decision && policy.decision !== outcome ? `${outcome} (${policy.decision})` : outcome) : NOT_REACHED;
  return {
    verdict: verdict || "other", word, tone, reason,
    fields: [
      { key: "agent", label: "Which agent acted", value: agent || NOT_REACHED },
      { key: "principal", label: "On whose behalf", value: person || NOT_REACHED },
      { key: "tool", label: "Which tool or resource", value: tool || NOT_REACHED },
      { key: "policy", label: "Which policy applied", value: policy ? `${policy.by}: ${policy.reason}` : NOT_REACHED },
      { key: "decision", label: "Decision", value: decided },
    ],
  };
}
