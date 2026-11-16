import { describe, expect, it } from "vitest";
import { NOT_REACHED, decisionOf } from "./decision";

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
