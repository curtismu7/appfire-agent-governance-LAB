// "Privilege settings in effect, as this run shows them": what the run's own evidence says about the settings that applied to the call: which
// agent identity acted, for whom, which groups the person was in, how the scopes were narrowed, where the token is good, for how long, what the
// gateway checked and what Authorize decided. Read from the tokens and hops the server sent, so it is REAL for a Real run and MOCK for a Mock
// one. It does NOT read the Privilege objects themselves (whether the agent's federated identity is enabled, who is in its group, the access
// policy): that needs an admin credential the lab does not hold, and the panel says so.
export const NOT_SHOWN = "Not read by the lab: whether the agent's federated identity is enabled, who is in its group, and the access policy itself. Those are PingOne Privilege and Agent IAM Core objects; reading them needs an admin credential this lab does not hold.";

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const scopes = (c) => (typeof c?.scope === "string" ? c.scope.split(/\s+/).filter(Boolean) : []);
const ran = (run, kind) => (run?.hops || []).find((h) => h.kind === kind && h.verdict !== "skip");
const NONE = "not in this run";

export function privilegeOf(run) {
  if (!run || typeof run !== "object" || run.kind === "guided" || run.computed === false || run.kind === "live") return null;
  const toks = (run.tokens || []).map((t) => t?.claims).filter((c) => c && typeof c === "object");
  const delegated = [...toks].reverse().find((c) => c.act && typeof c.act === "object" && text(c.act.sub)) || null;
  const user = toks.find((c) => c !== delegated && !c.act) || null;
  const agent = text(delegated?.act?.sub) || text(delegated?.client_id);
  const person = text(delegated?.sub) || text(user?.sub);

  const had = scopes(user), got = scopes(delegated);
  const scopeText = got.length
    ? `${got.join(" ")}${had.length ? ` (narrowed from ${had.length} the person holds to ${got.length})` : ""}`
    : NONE;
  const groups = Array.isArray(user?.groups) ? user.groups : null;
  const life = typeof delegated?.exp === "number" && typeof delegated?.iat === "number" ? delegated.exp - delegated.iat : null;

  const gw = ran(run, "gateway-check")?.response?.body;
  const checks = Array.isArray(gw?.checks) ? gw.checks : null;
  const failed = checks?.find((c) => c && c.ok === false);
  const gateway = checks ? (failed ? `stopped at ${failed.check}${text(failed.why) ? `: ${failed.why}` : ""}` : `${checks.map((c) => `${c.check} ok`).join(", ")}`) : ran(run, "gateway-check") ? "the gateway did not report its checks" : NONE;
  const az = ran(run, "authorize-decision")?.response?.body;
  const authorize = az && text(az.decision) ? `${az.decision}${text(az.reason) ? `: ${az.reason}` : ""}` : NONE;

  const rows = [
    { key: "agent", label: "Agent identity that acted", value: agent || NONE },
    { key: "person", label: "Acting for", value: person || NONE },
    { key: "groups", label: "The person's groups", value: groups ? (groups.length ? groups.join(", ") : "none in the token") : NONE },
    { key: "scopes", label: "Scopes the agent was given", value: scopeText },
    { key: "audience", label: "Good for one destination", value: text(delegated?.aud) || NONE },
    { key: "lifetime", label: "Token lifetime", value: life != null ? `${life} seconds` : NONE },
    { key: "gateway", label: "Gateway checks", value: gateway },
    { key: "authorize", label: "Authorize decided", value: authorize },
  ];
  const passed = checks ? `${checks.filter((c) => c && c.ok !== false).length} of ${checks.length} gateway checks` : null;
  const summary = [agent ? `agent ${agent}` : null, person ? `for ${person}` : null, got.length && had.length ? `${got.length} of ${had.length} scopes` : null, passed].filter(Boolean).join(" · ");
  return { source: run.kind === "real" ? "real" : "mock", summary, rows, notShown: NOT_SHOWN };
}
