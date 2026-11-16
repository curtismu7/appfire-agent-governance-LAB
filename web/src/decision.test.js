import { describe, expect, it } from "vitest";
import { NOT_REACHED, RISK_RUNGS, compareRows, decisionOf, riskLevelOf } from "./decision";
import { NOT_SHOWN, privilegeOf } from "./privilege";
import { overridesIn } from "./instructions";

// Hop and token shapes copied from real mock runs of the engine (UC1, UC7, UC8, UC13, UC16b, UC31); only the fields the card reads are kept.
const hop = (kind, body, extra = {}) => ({ n: 1, kind, verdict: "ok", response: { body }, ...extra });
const tokens = [
  { label: "user token (MOCK)", claims: { sub: "alex.morgan", scope: "openid accounts:read transfers:write" } },
  { label: "exchanged token (MOCK)", claims: { sub: "alex.morgan", aud: "https://mcp.example", scope: "accounts:read", client_id: "triage-agent", act: { sub: "triage-agent" } } },
];
const plan = (name) => hop("llm-plan", { tool_calls: [{ name, arguments: {} }] });
const authz = (decision, reason, action) => hop("authorize-decision", { decision, reason }, { request: { body: { subject: "alex.morgan", action, context: { act: { sub: "triage-agent" } } } } });

const allowed = { kind: "flow", computed: true, outcome: "PERMIT", tokens, hops: [plan("get_account_balance"), authz("PERMIT", "no rule restricts this call", "get_account_balance"),
  hop("gateway-check", { forwarded: true, checks: [{ check: "signature", ok: true }] }), hop("tool-dispatched", { result: { tool: "get_account_balance", isError: false } })] };
const gatewayDeny = { kind: "flow", computed: true, outcome: "DENY", tokens, hops: [plan("get_weather"),
  hop("gateway-check", { error: "policy_denied", checks: [{ check: "signature", ok: true }, { check: "scope", ok: true }, { check: "policy_denied", ok: false, why: "edge policy: the configured state scope is TX" }] }, { verdict: "deny" }),
  hop("tool-refused", { dispatched: false, refused_by: "gateway", outcome: "DENY", reason: "policy_denied" }, { verdict: "deny" })] };
const stepUp = { kind: "flow", computed: true, outcome: "STEP_UP", tokens, hops: [plan("create_transfer"), authz("STEP_UP", "amount 600 is in the STEP_UP band (lab-invented threshold 500)", "create_transfer"),
  hop("tool-held", { dispatched: false, waiting_for: "STEP_UP" }, { verdict: "held" })] };
const human = { kind: "flow", computed: true, outcome: "HITL_REQUIRED", tokens, hops: [plan("create_transfer"), authz("HITL_REQUIRED", "amount 300 needs a person", "create_transfer"),
  hop("step-up", { obligation: "HITL_REQUIRED", needs: "a person in the loop", approved: false }, { verdict: "held" }), hop("tool-held", { dispatched: false, waiting_for: "HITL_REQUIRED" }, { verdict: "held" })] };
const injected = { kind: "flow", computed: true, outcome: "DENY", tokens, hops: [authz("DENY", "the acting agent in the act chain is not a registered agent", "get_account_balance"),
  hop("tool-refused", { dispatched: false, refused_by: "authorize", outcome: "DENY", reason: "the acting agent in the act chain is not a registered agent" }, { verdict: "deny" })] };
const bffDeny = { kind: "flow", computed: true, outcome: "DENY_403", tokens: [], hops: [hop("tool-refused", { dispatched: false, refused_by: "bff", outcome: "DENY_403", reason: "user_token_forwarding_disabled" }, { verdict: "deny" })] };

const field = (d, key) => d.fields.find((f) => f.key === key).value;

describe("decisionOf", () => {
  it("returns nothing while there is no run", () => {
    expect(decisionOf(null)).toBeNull();
    expect(decisionOf(undefined)).toBeNull();
    expect(decisionOf("run")).toBeNull();
  });

  it("an allowed read names the agent, the person, the tool and the policy that let it through", () => {
    const d = decisionOf(allowed);
    expect(d).toMatchObject({ verdict: "allowed", word: "ALLOWED", tone: "ok" });
    expect(d.reason).toBe("Allowed: no rule restricts this call. The tool ran.");
    expect(field(d, "agent")).toBe("triage-agent");
    expect(field(d, "principal")).toBe("alex.morgan");
    expect(field(d, "tool")).toBe("get_account_balance");
    expect(field(d, "policy")).toBe("Agent Authorize: no rule restricts this call");
    expect(field(d, "decision")).toBe("PERMIT");
    expect(d.fields.map((f) => f.label)).toEqual(["Which agent acted", "On whose behalf", "Which tool or resource", "Which policy applied", "Decision"]);
  });

  it("a gateway refusal is DENIED, says who refused and why, and that nothing reached the tool", () => {
    const d = decisionOf(gatewayDeny);
    expect(d).toMatchObject({ verdict: "denied", word: "DENIED", tone: "bad" });
    expect(d.reason).toBe("Refused by the gateway: edge policy: the configured state scope is TX. Nothing was dispatched to the tool.");
    expect(field(d, "tool")).toBe("get_weather");
    expect(field(d, "decision")).toBe("DENY");
  });

  it("a step-up is ESCALATED, waits for a second factor and has not run", () => {
    const d = decisionOf(stepUp);
    expect(d).toMatchObject({ verdict: "escalated", word: "ESCALATED", tone: "warn" });
    expect(d.reason).toBe("Held: amount 600 is in the STEP_UP band (lab-invented threshold 500). The write waits for a second factor; it has not run.");
    expect(field(d, "tool")).toBe("create_transfer");
    expect(field(d, "decision")).toBe("STEP_UP");
  });

  it("a human-approval hold is ESCALATED and says a person is needed", () => {
    const d = decisionOf(human);
    expect(d).toMatchObject({ verdict: "escalated", word: "ESCALATED" });
    expect(d.reason).toContain("waits for a person");
    expect(field(d, "decision")).toBe("HITL_REQUIRED");
  });

  it("a forged actor is refused by Agent Authorize with the lab's own reason", () => {
    const d = decisionOf(injected);
    expect(d.word).toBe("DENIED");
    expect(d.reason).toBe("Refused by Agent Authorize: the acting agent in the act chain is not a registered agent. Nothing was dispatched to the tool.");
  });

  it("a refusal at the BFF names the BFF and keeps the HTTP-style outcome", () => {
    const d = decisionOf(bffDeny);
    expect(d.word).toBe("DENIED");
    expect(d.reason).toContain("Refused by the BFF (the app's back end): user_token_forwarding_disabled.");
    expect(field(d, "decision")).toBe("DENY_403");
    expect(field(d, "agent")).toBe(NOT_REACHED);
    expect(field(d, "principal")).toBe(NOT_REACHED);
  });

  it("a guided page and an identity-provider-only run carry no decision of their own", () => {
    expect(decisionOf({ kind: "guided", computed: false, outcome: "PERMIT", hops: [] })).toMatchObject({ verdict: "guided", word: "GUIDED", fields: [] });
    expect(decisionOf({ kind: "live", outcome: "LIVE_OK", hops: [] })).toMatchObject({ verdict: "idp", word: "IDENTITY PROVIDER ONLY", fields: [] });
  });

  it("a Real run that did not reach a decision says so instead of guessing", () => {
    const d = decisionOf({ kind: "real", computed: true, outcome: "REAL_NO_ACT", tokens: [], hops: [] });
    expect(d).toMatchObject({ verdict: "other", word: "NOT COMPLETED", tone: "bad" });
    expect(decisionOf({ kind: "real", computed: true, outcome: "REAL_HOLD", tokens: [], hops: [] }).word).toBe("ESCALATED");
    expect(decisionOf({ kind: "real", computed: true, outcome: "REAL_PERMIT", tokens: [], hops: [] }).word).toBe("ALLOWED");
  });

  it("never throws on a sparse run", () => {
    expect(() => decisionOf({ outcome: "DENY" })).not.toThrow();
    expect(decisionOf({ outcome: "DENY" }).fields.every((f) => f.key === "decision" || f.value === NOT_REACHED)).toBe(true);
  });
});

describe("risk strip level", () => {
  it("places each run on the control it ended in: proceeds, second factor, a person, refused", () => {
    expect(riskLevelOf(allowed)).toBe(1);
    expect(riskLevelOf(stepUp)).toBe(2);
    expect(riskLevelOf(human)).toBe(3);
    expect(riskLevelOf(gatewayDeny)).toBe(4);
    expect(riskLevelOf(injected)).toBe(4);
    expect(riskLevelOf(bffDeny)).toBe(4);
    expect(RISK_RUNGS.map((r) => r.word)).toEqual(["PERMIT", "STEP_UP", "HITL_REQUIRED", "DENY"]);
  });

  it("the card carries the level; Real outcomes map the same way; a hold with an approval is a person", () => {
    expect(decisionOf(stepUp).level).toBe(2);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_PERMIT" })).toBe(1);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_HOLD" })).toBe(3);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_DENY" })).toBe(4);
    expect(riskLevelOf({ outcome: "CIBA" })).toBe(3);
  });

  it("no level when no decision was made: guided, identity-provider-only, not completed, no run", () => {
    expect(riskLevelOf({ kind: "guided", computed: false, outcome: "PERMIT" })).toBeNull();
    expect(riskLevelOf({ kind: "live", outcome: "LIVE_OK" })).toBeNull();
    expect(riskLevelOf({ kind: "real", outcome: "REAL_NO_ACT" })).toBeNull();
    expect(riskLevelOf(null)).toBeNull();
    expect(decisionOf({ kind: "guided", computed: false, outcome: "PERMIT" }).level).toBeNull();
  });
});

describe("compareRows", () => {
  it("lines up the verdict and the five facts, and marks only the rows that differ", () => {
    const rows = compareRows(allowed, gatewayDeny);
    expect(rows.map((r) => r.key)).toEqual(["verdict", "agent", "principal", "tool", "policy", "decision"]);
    const diff = Object.fromEntries(rows.map((r) => [r.key, r.differs]));
    expect(diff).toEqual({ verdict: true, agent: false, principal: false, tool: true, policy: true, decision: true });
    expect(rows[0]).toMatchObject({ left: "ALLOWED", right: "DENIED" });
  });

  it("two runs that decide the same way differ on nothing but what they touched", () => {
    const rows = compareRows(allowed, allowed);
    expect(rows.every((r) => r.differs === false)).toBe(true);
  });

  it("returns nothing unless both runs exist", () => {
    expect(compareRows(allowed, null)).toEqual([]);
    expect(compareRows(null, allowed)).toEqual([]);
    expect(compareRows(null, null)).toEqual([]);
  });
});

describe("steered runs", () => {
  const steered = { ...gatewayDeny, outcome: "DENY", steered: { asked: { tool: "get_account_balance", amount: null }, proposed: { tool: "create_transfer", amount: 2500 }, reasons: ["ignore all"] } };
  it("the card says what the instructions steered the agent to propose against what the customer asked", () => {
    expect(decisionOf(steered).steer).toBe("The agent's instructions steered it: it proposed create_transfer for 2500 though the customer asked for get_account_balance.");
    expect(decisionOf(allowed).steer).toBeNull();
    expect(decisionOf({ kind: "guided", computed: false, outcome: "PERMIT" }).steer).toBeNull();
    expect(decisionOf({ ...stepUp, steered: { proposed: { tool: "create_transfer" } } }).steer).toMatch(/though the customer asked for something else/);
  });

  it("finds override phrases case-insensitively, in the server's order, and nothing else", () => {
    const phrases = ["ignore all", "do not ask", "largest amount"];
    expect(overridesIn("IGNORE ALL limits; do not ask", phrases)).toEqual(["ignore all", "do not ask"]);
    expect(overridesIn("Use only the tools you are given.", phrases)).toEqual([]);
    expect(overridesIn("x", undefined)).toEqual([]);
  });
});

describe("privilegeOf", () => {
  const user = { label: "user token (MOCK)", claims: { sub: "alex.morgan", scope: "openid accounts:read transfers:write accounts:sensitive portfolio:read", groups: ["wp-a2a-users"] } };
  const delegated = { label: "exchanged token (MOCK)", claims: { sub: "alex.morgan", aud: "https://mcp.example", scope: "accounts:read", client_id: "triage-agent", iat: 1000, exp: 1300, act: { sub: "triage-agent" } } };
  const gw = (checks) => hop("gateway-check", { forwarded: true, checks });
  const base = { kind: "flow", computed: true, outcome: "PERMIT", tokens: [user, delegated], hops: [authz("PERMIT", "no rule restricts this call", "get_account_balance"), gw([{ check: "signature", ok: true }, { check: "aud", ok: true }, { check: "act", ok: true }, { check: "scope", ok: true }])] };
  const value = (p, key) => p.rows.find((r) => r.key === key).value;

  it("reads the agent identity, the person, the groups, how scopes were narrowed, the audience, the lifetime, the gateway checks and the decision", () => {
    const p = privilegeOf(base);
    expect(p.source).toBe("mock");
    expect(value(p, "agent")).toBe("triage-agent");
    expect(value(p, "person")).toBe("alex.morgan");
    expect(value(p, "groups")).toBe("wp-a2a-users (claim groups)");
    expect(value(p, "scopes")).toBe("accounts:read (narrowed from 5 the person holds to 1)");
    expect(value(p, "audience")).toBe("https://mcp.example");
    expect(value(p, "lifetime")).toBe("300 seconds");
    expect(value(p, "gateway")).toBe("signature ok, aud ok, act ok, scope ok");
    expect(value(p, "authorize")).toBe("PERMIT: no rule restricts this call");
    expect(p.summary).toBe("agent triage-agent · for alex.morgan · 1 of 5 scopes · 4 of 4 gateway checks");
  });

  it("a refusal shows where the gateway stopped; a Real run is marked REAL and says what the token does not carry", () => {
    const p = privilegeOf({ ...base, kind: "real", outcome: "REAL_DENY", tokens: [{ claims: { sub: "u-1" } }, { claims: { sub: "u-1", act: { sub: "agent-1" } } }], hops: [gw([{ check: "scope", ok: false, why: "scope not granted" }])] });
    expect(p.source).toBe("real");
    expect(value(p, "gateway")).toBe("stopped at scope: scope not granted");
    expect(value(p, "groups")).toBe("no group claim in the user's token");
    expect(value(p, "lifetime")).toBe("not in this run");
    expect(value(p, "agent")).toBe("agent-1");
  });

  it("always says what it does not read, and shows nothing for a guided page, an identity-provider-only run or no run", () => {
    expect(privilegeOf(base).notShown).toBe(NOT_SHOWN);
    expect(NOT_SHOWN).toMatch(/federated identity is enabled.*who is in its group.*access policy/);
    expect(privilegeOf({ kind: "guided", computed: false })).toBeNull();
    expect(privilegeOf({ kind: "live", outcome: "LIVE_OK" })).toBeNull();
    expect(privilegeOf(null)).toBeNull();
  });
});

describe("tier use cases in Real", () => {
  it("reads the person's groups from PingOne's memberOfGroupNames claim too, and says when the claim is empty", () => {
    const tok = (claims) => ({ claims });
    const mk = (userClaims) => ({ kind: "real", computed: true, outcome: "REAL_PERMIT", tokens: [tok({ sub: "u-1", ...userClaims }), tok({ sub: "u-1", act: { sub: "agent-1" } })], hops: [] });
    const g = (run) => privilegeOf(run).rows.find((r) => r.key === "groups").value;
    expect(g(mk({ memberOfGroupNames: ["premium-tier", "staff"] }))).toBe("premium-tier, staff (claim memberOfGroupNames)");
    expect(g(mk({ memberOfGroupNames: "premium-tier" }))).toBe("premium-tier (claim memberOfGroupNames)");
    expect(g(mk({ groups: [] }))).toBe("none (claim groups is empty)");
    expect(g(mk({}))).toBe("no group claim in the user's token");
  });

  it("a tool the gateway does not offer is NOT OFFERED (a standard tier), not a refusal and not a failure", () => {
    const d = decisionOf({ kind: "real", computed: true, outcome: "REAL_NOT_LISTED", tokens, hops: [] });
    expect(d).toMatchObject({ verdict: "not-offered", word: "NOT OFFERED", tone: "warn", level: null });
    expect(d.reason).toMatch(/did not offer the tool to this user, so the agent never called it/);
    expect(d.fields.find((f) => f.key === "tool").value).toBe("not offered, so never called");
    expect(d.fields.find((f) => f.key === "decision").value).toBe("REAL_NOT_LISTED");
    expect(riskLevelOf({ kind: "real", outcome: "REAL_NOT_LISTED" })).toBeNull();
  });
});
