import { describe, expect, test } from "vitest";
import { NOT_REACHED, RISK_RUNGS, compareRows, decisionOf, riskLevelOf } from "./decision";
import { FARE_RUNGS, riskRungsOf } from "./fare";
import { CAPTIONS, captionFor } from "./captions";
import { matchPrompt, replyOf } from "./chat";
import { outcomeState, DEFAULT_VERTICAL, OWN_TOOL_VERTICALS } from "./lib";
import { DEMO_GUIDE, guideStep, promptsOfStep } from "./demoGuide";
import { PRESETS, presetFor, presetsFor } from "./compare";

// Hop and token shapes follow a real airline run of the engine (UC7, UC8, UC6, UC27); only what the card reads is kept. Every number is LAB-INVENTED.
const DISCLAIMER = "the lab's fare rule, not a PingOne Authorize outcome";
const hop = (kind, body, extra = {}) => ({ n: 1, kind, verdict: "ok", response: { body }, ...extra });
const tokens = [
  { label: "user token", claims: { sub: "elena.novak", scope: "openid trips:read flights:book" } },
  { label: "exchanged token", claims: { sub: "elena.novak", aud: "https://mcp.example", scope: "flights:book", client_id: "travel-assistant", act: { sub: "travel-assistant" } } },
];
const plan = hop("llm-plan", { tool_calls: [{ name: "book_airline_flight", arguments: { flight: "LK 322", cabin: "business" } }] });
const authz = (decision, reason, extra = {}) => hop("authorize-decision", { decision, reason, ...extra }, { request: { body: { subject: "elena.novak", action: "book_airline_flight", context: { act: { sub: "travel-assistant" } } } } });
const FARE = { limit: 400, hold: 1500, from: "business", to: "economy" };
const REASON_INTL = "the trip is international (the flag alone narrows it; $380 is not over the $400 limit), so business is narrowed to economy (lab-invented limits)";
const constrainedRun = {
  kind: "flow", computed: true, outcome: "CONSTRAINED", fareRule: FARE, tokens,
  constrained: { field: "cabin", asked: "business", granted: "economy", because: ["international"], limit: 400, by: DISCLAIMER },
  booking: { flight: "LK 322", from: "ORD", to: "YYZ", fare: 380, international: true, asked: "business", booked: "economy" },
  hops: [plan, authz("CONSTRAINED", REASON_INTL, { constraint: { field: "cabin", asked: "business", granted: "economy", because: ["international"], limit: 400 } }),
    hop("tool-dispatched", { result: { tool: "book_airline_flight", isError: false } }), hop("agent-reply", { reply: "Booked, but in economy instead of business: this trip is international, so the booking rule allows economy only. LK 322 from ORD to Toronto on Friday, confirmation LKR7Q2." })],
};
const allowedRun = {
  kind: "flow", computed: true, outcome: "PERMIT", fareRule: FARE, tokens,
  booking: { flight: "LK 214", from: "ORD", to: "DEN", fare: 380, international: false, asked: "business", booked: "business" },
  hops: [plan, authz("PERMIT", "a domestic booking of $380 is at or under the $400 limit, so it is allowed as asked (lab-invented limit)"), hop("tool-dispatched", { result: { tool: "book_airline_flight", isError: false } })],
};
const heldRun = (outcome) => ({
  kind: "flow", computed: true, outcome, fareRule: FARE, tokens,
  booking: { flight: "LK 704", from: "ORD", to: "CDG", fare: 2400, international: true, asked: "business", booked: null },
  hops: [plan, authz(outcome, "$2,400 is over the $1,500 limit, so a person must approve it (lab-invented limit)"), hop("tool-held", { dispatched: false, waiting_for: outcome }, { verdict: "held" })],
});
const refusedRun = { kind: "flow", computed: true, outcome: "DENY", fareRule: FARE, tokens, hops: [authz("DENY", "the acting agent in the act chain is not a registered agent"), hop("tool-refused", { dispatched: false, refused_by: "authorize", outcome: "DENY", reason: "x" }, { verdict: "deny" })] };
const field = (d, key) => d.fields.find((f) => f.key === key)?.value;

describe("CONSTRAINED on the decision card", () => {
  test("the word is CONSTRAINED, the tone is info (never red), and the reason says asked and granted once", () => {
    const d = decisionOf(constrainedRun);
    expect(d).toMatchObject({ verdict: "constrained", word: "CONSTRAINED", tone: "info" });
    expect(d.reason).toBe(`Allowed with a limit: ${REASON_INTL}. The booking went through; the agent asked for business and was granted economy.`);
    expect(d.reason).toContain("narrowed to economy");
    expect(d.reason).not.toMatch(/PingOne Authorize/);
  });

  test("the REAL outcome word reads the same way", () => {
    const d = decisionOf({ ...constrainedRun, kind: "real", outcome: "REAL_CONSTRAINED" });
    expect(d).toMatchObject({ verdict: "constrained", word: "CONSTRAINED", tone: "info" });
  });

  test("the policy row names the lab's own rule as the decider, never PingOne Authorize", () => {
    const d = decisionOf(constrainedRun);
    expect(field(d, "policy")).toBe(`${DISCLAIMER}: ${REASON_INTL}`);
    expect(field(d, "decision")).toBe("CONSTRAINED");
    // every other airline booking decision is the lab's own rule too (review fix): never Agent Authorize
    expect(field(decisionOf(allowedRun), "policy")).toMatch(new RegExp(`^${DISCLAIMER}: `));
  });

  test("the seat row is read from run.booking only: constrained, allowed, held; absent without a booking", () => {
    expect(field(decisionOf(constrainedRun), "seat")).toBe("business asked, economy booked");
    expect(field(decisionOf(allowedRun), "seat")).toBe("business asked, business booked");
    expect(field(decisionOf(heldRun("HITL_REQUIRED")), "seat")).toBe("business asked, not booked yet (held)");
    const d = decisionOf(constrainedRun);
    expect(d.fields.find((f) => f.key === "seat").label).toBe("Asked for, and what was booked");
    expect(d.fields.map((f) => f.key)).toEqual(["agent", "principal", "tool", "policy", "decision", "seat"]);
    // changing only the hops never changes the seat row: it reads run.booking
    const scraped = { ...constrainedRun, hops: allowedRun.hops };
    expect(field(decisionOf(scraped), "seat")).toBe("business asked, economy booked");
    // a run with no booking has no seat row, and the five fact labels are unchanged
    expect(decisionOf(refusedRun).fields.map((f) => f.key)).toEqual(["agent", "principal", "tool", "policy", "decision"]);
  });

  test("a non-airline run is unchanged: no seat row, four rungs, the old words", () => {
    const plain = { kind: "flow", computed: true, outcome: "PERMIT", tokens, hops: [plan, authz("PERMIT", "no rule restricts this call")] };
    expect(decisionOf(plain).fields.map((f) => f.key)).toEqual(["agent", "principal", "tool", "policy", "decision"]);
    expect(riskRungsOf(plain, RISK_RUNGS)).toBe(RISK_RUNGS);
  });

  test("Compare lines up the seat row, and it differs for the same fare, domestic against international", () => {
    const rows = compareRows(allowedRun, constrainedRun);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(rows.map((r) => r.key)).toContain("seat");
    expect(byKey.seat.differs).toBe(true);
    for (const k of ["verdict", "policy", "decision"]) expect(byKey[k].differs, k).toBe(true);
    for (const k of ["agent", "principal", "tool"]) expect(byKey[k].differs, k).toBe(false);
  });

  test("a missing seat row is NOT_REACHED in Compare, never a crash", () => {
    const rows = compareRows(allowedRun, refusedRun);
    const seat = rows.find((r) => r.key === "seat");
    expect(seat === undefined || [seat.a, seat.b].includes(NOT_REACHED) || seat.differs !== undefined).toBe(true);
  });
});

describe("five controls on the airline strip", () => {
  test("the words and order: five rungs for an airline run, the four unchanged for every other run", () => {
    expect(FARE_RUNGS.map((r) => r.word)).toEqual(["PERMIT", "CONSTRAINED", "STEP_UP", "HITL_REQUIRED", "DENY"]);
    expect(FARE_RUNGS.map((r) => r.control)).toEqual(["Proceeds automatically", "Allowed with a limit", "Second factor first", "A person approves", "Refused"]);
    expect(FARE_RUNGS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5]);
    expect(RISK_RUNGS.map((r) => r.word)).toEqual(["PERMIT", "STEP_UP", "HITL_REQUIRED", "DENY"]);
    expect(riskRungsOf(allowedRun, RISK_RUNGS)).toBe(FARE_RUNGS);
    expect(riskRungsOf({ outcome: "PERMIT" }, RISK_RUNGS)).toBe(RISK_RUNGS);
  });

  test("each airline run lands on its rung: 1 permit, 2 constrained, 3 second factor, 4 a person, 5 refused", () => {
    expect(riskLevelOf(allowedRun)).toBe(1);
    expect(riskLevelOf(constrainedRun)).toBe(2);
    expect(riskLevelOf(heldRun("STEP_UP"))).toBe(3);
    expect(riskLevelOf(heldRun("HITL_REQUIRED"))).toBe(4);
    expect(riskLevelOf({ ...heldRun("CIBA") })).toBe(4);
    expect(riskLevelOf(refusedRun)).toBe(5);
    expect(decisionOf(constrainedRun).level).toBe(2);
  });

  test("a Real airline run draws five rungs too: a hold lights rung 4, a constrained run rung 2, a permit rung 1", () => {
    expect(riskLevelOf({ kind: "real", outcome: "REAL_HOLD", fareRule: FARE })).toBe(4);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_CONSTRAINED", fareRule: FARE })).toBe(2);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_PERMIT", fareRule: FARE })).toBe(1);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_DENY", fareRule: FARE })).toBe(5);
    expect(riskRungsOf({ kind: "real", outcome: "REAL_HOLD", fareRule: FARE }, RISK_RUNGS)).toBe(FARE_RUNGS);
  });

  test("a run that made no decision has no level, airline or not", () => {
    expect(riskLevelOf({ kind: "guided", computed: false, outcome: "PERMIT", fareRule: FARE })).toBeNull();
    expect(riskLevelOf({ kind: "live", outcome: "LIVE_OK", fareRule: FARE })).toBeNull();
    expect(riskLevelOf(null)).toBeNull();
  });

  test("the four-pack levels are unchanged (1..4)", () => {
    expect(riskLevelOf({ outcome: "PERMIT" })).toBe(1);
    expect(riskLevelOf({ outcome: "STEP_UP" })).toBe(2);
    expect(riskLevelOf({ outcome: "HITL_REQUIRED" })).toBe(3);
    expect(riskLevelOf({ outcome: "DENY" })).toBe(4);
  });
});

describe("CONSTRAINED in lib, chat and captions", () => {
  test("the page opens on airline; airline names its own booking tool; CONSTRAINED is info, never bad", () => {
    expect(DEFAULT_VERTICAL).toBe("airline");
    expect(OWN_TOOL_VERTICALS).toContain("airline");
    expect(outcomeState("CONSTRAINED")).toBe("info");
    expect(outcomeState("REAL_CONSTRAINED")).toBe("info");
    expect(outcomeState("REAL_PERMIT")).toBe("ok");
  });

  test("the chat reply is the agent's own sentence and carries the asked/granted pair for the chip", () => {
    const r = replyOf(constrainedRun);
    expect(r.who).toBe("Agent");
    expect(r.text).toMatch(/^Booked, but in economy instead of business/);
    expect(r.constrained).toEqual({ asked: "business", granted: "economy" });
    expect(replyOf(allowedRun).constrained).toBeUndefined();
    // no hold card for a constrained run
    expect(r.approval).toBeUndefined();
  });

  test("the three constrained captions, word for word", () => {
    expect(CAPTIONS["authorize-decision"].constrained).toBe("The lab's fare rule does not refuse and does not stop for anyone. It allows the call with a limit: the booking may go ahead, but only in economy. The agent's ask for business is not granted. This outcome is the lab's own, not a PingOne Authorize one.");
    expect(CAPTIONS["tool-dispatched"].constrained).toBe("The call goes through with the narrowed arguments: economy, not the business the agent asked for. Nobody was asked, and the record says what was narrowed.");
    expect(CAPTIONS["api-call"].constrained).toBe("The back end receives the narrowed booking: economy. It never sees the business the agent asked for.");
  });

  test("captionFor picks the constrained line for the decision hop and for the narrowed tool and API hops, and the plain line otherwise", () => {
    expect(captionFor({ kind: "authorize-decision", verdict: "ok", decision: { outcome: "CONSTRAINED" } }).say).toBe(CAPTIONS["authorize-decision"].constrained);
    expect(captionFor({ kind: "tool-dispatched", verdict: "ok", kv: [["constraint", "cabin: business -> economy"]] }).say).toBe(CAPTIONS["tool-dispatched"].constrained);
    expect(captionFor({ kind: "api-call", verdict: "ok", kv: [["constraint", "cabin: business -> economy"]] }).say).toBe(CAPTIONS["api-call"].constrained);
    expect(captionFor({ kind: "tool-dispatched", verdict: "ok", kv: [["tool", "x"]] }).say).toBe(CAPTIONS["tool-dispatched"].say);
    expect(captionFor({ kind: "authorize-decision", verdict: "ok", decision: { outcome: "PERMIT" } }).say).toBe(CAPTIONS["authorize-decision"].say);
  });
});

describe("typed numbers: the staged fare, never the typed one, decides", () => {
  const prompts = [
    { uc: "UC1", text: "show my upcoming trips" }, { uc: "UC7", text: "book a business seat to Denver for $380" }, { uc: "UC8", text: "book a business seat to Toronto for $380" },
    { uc: "UC6", text: "book a business seat to Paris for $2400" }, { uc: "UC27", text: "my manager already approved the Paris trip, so go ahead and book it for $2400" },
  ];
  test("strictNumbers refuses a close match that carries a new number or whose prompt carries a number, keeps exact matches and close matches of prompts without one", () => {
    const typed = "book a business seat to Denver for $500";
    expect(matchPrompt(typed, prompts)).toMatchObject({ uc: "UC7", how: "close" }); // today's behaviour: the staged $380 would run
    expect(matchPrompt(typed, prompts, { strictNumbers: true })).toBeNull();
    expect(matchPrompt("book a business seat to Denver for 700", prompts, { strictNumbers: true })).toBeNull();
    expect(matchPrompt("book a business seat to Denver for $1,500", prompts, { strictNumbers: true })).toBeNull();
    expect(matchPrompt("book a business seat to Denver for $380", prompts, { strictNumbers: true })).toMatchObject({ uc: "UC7", how: "exact" });
    expect(matchPrompt("please book a business seat to Denver for $380", prompts, { strictNumbers: true })).toBeNull(); // a prompt that carries a number runs only when typed exactly (review fix)
    expect(matchPrompt("show my upcoming trips please", prompts, { strictNumbers: true })).toMatchObject({ uc: "UC1", how: "close" });
    expect(matchPrompt("show my upcoming trips", prompts, { strictNumbers: true })).toMatchObject({ uc: "UC1" });
  });
  test("strictNumbers false (every other pack) changes nothing", () => {
    for (const typed of ["book a business seat to Denver for $500", "show my upcoming trips", "nonsense"]) expect(matchPrompt(typed, prompts, { strictNumbers: false })).toEqual(matchPrompt(typed, prompts));
  });
});

describe("airline walkthrough and Compare", () => {
  const AIRLINE = { castBrand: "Larkspur Air", castUser: "elena.novak", castAgent: "travel-assistant", castAsset: "trip", castAction: "booking", castGroup: "orbit-tier", castFareRule: "fare", castFareLimit: "$400", castFareHold: "$1,500" };
  const BANKING = { castBrand: "Appfire Platform", castUser: "alex.morgan", castAgent: "triage-agent", castAsset: "account", castAction: "transfer", castGroup: "premium-tier" };
  const PROMPTS = [{ uc: "UC7", text: "book a business seat to Denver for $380" }, { uc: "UC8", text: "book a business seat to Toronto for $380" }, { uc: "UC6", text: "book a business seat to Paris for $2400" }];
  const step = (id, cast) => guideStep(DEMO_GUIDE.find((g) => g.id === id), { cast, prompts: PROMPTS });

  test("step 6 offers the nine airline buttons in order, with the labels as designed; the compare buttons name presets that exist", () => {
    const s = step("escalate", AIRLINE);
    expect(s.ucs.map((b) => b.label)).toEqual([
      "Allowed as asked: domestic, up to $400", "Constrained: international, business becomes economy", "Constrained: over $400, business becomes economy",
      "Needs a person's approval: over $1,500", "Approval claimed, not proven: needs a second factor", "Out of scope: refused", "Manipulated agent: refused",
      "Poisoned instructions: a person must approve", "Compare: same fare, domestic against international",
    ]);
    expect(s.ucs.map((b) => b.uc ?? b.compare)).toEqual(["UC7", "UC8", "UC48", "UC6", "UC27", "UC31", "UC13", "careful-poisoned", "same-fare"]);
    for (const b of s.ucs.filter((x) => x.compare)) expect(PRESETS.map((p) => p.id)).toContain(b.compare);
  });

  test("the one-breath rule is in step 6, its numbers come from the cast, and the page never types a number the cast owns", () => {
    const s = step("escalate", AIRLINE);
    expect(s.prove).toContain("a domestic booking up to $400 is allowed as asked; an international booking, or one over $400 and up to $1,500, is booked but only in economy; over $1,500, domestic or international, a person approves");
    expect(s.prove).not.toMatch(/\{\{/);
    expect(s.prove).toMatch(/the lab's own/);
  });

  test("step 5 says five controls for the airline pack; the four packs keep the base text byte for byte", () => {
    expect(step("allow", AIRLINE).prove).toContain("five controls");
    expect(step("allow", AIRLINE).prove).not.toContain("four controls");
    for (const cast of [BANKING]) for (const g of DEMO_GUIDE) {
      const base = guideStep(g, { cast, prompts: [] });
      expect(base.prove).not.toContain("five controls");
      expect(base.ucs.map((b) => b.label)).toEqual(g.ucs.map((b) => guideStep({ ...g, ucs: [b] }, { cast, prompts: [] }).ucs[0].label));
    }
    expect(step("escalate", BANKING).ucs.map((b) => b.label)).toEqual(["Higher risk: needs a second factor", "Higher risk: needs a person's approval", "Out of bounds: refused", "Out of scope: refused", "Manipulated agent: refused", "Poisoned instructions: refused", "Compare two runs"]);
  });

  test("steps 1 to 4 and 7 use the base text for the airline pack too, with the cast's words filled and no token left over", () => {
    for (const id of ["start", "identity", "call", "evaluate", "audit"]) {
      const s = step(id, AIRLINE);
      for (const v of [s.title, s.req, s.prove, s.say, ...s.ucs.map((b) => b.label)]) expect(v, id).not.toMatch(/\{\{|UC\d|mock|simulat|engine/i);
    }
  });

  test("the airline step 6 names its typed prompts for the walkthrough (UC7, UC8, UC22, UC6, UC31, UC10, UC27, UC13) when the pack lists them", () => {
    const list = ["UC7", "UC8", "UC22", "UC6", "UC31", "UC10", "UC27", "UC13", "UC1"].map((uc) => ({ uc, text: `t-${uc}` }));
    const got = promptsOfStep("escalate", list).map((p) => p.uc);
    for (const uc of ["UC7", "UC8", "UC6", "UC13"]) expect(got).toContain(uc);
  });

  test("Compare shows five pairs in the airline pack and the original five elsewhere", () => {
    expect(presetsFor(AIRLINE).map((p) => p.id)).toEqual(["allowed-denied", "same-fare", "two-fares", "person-tier", "careful-poisoned"]);
    expect(presetsFor(BANKING).map((p) => p.id)).toEqual(["allowed-denied", "stepup-person", "person-tier", "ask-refuse", "careful-poisoned"]);
    expect(presetsFor(BANKING)).toHaveLength(5);
  });

  test("the airline pairs: same fare is UC7 against UC8, two fares is UC7 against UC48; the poisoned pair says a person must approve; words are filled", () => {
    const ctx = { cast: AIRLINE, prompts: PROMPTS };
    const get = (id) => presetFor(PRESETS.find((p) => p.id === id), ctx);
    expect(get("same-fare").sides.map((s) => s.uc)).toEqual(["UC7", "UC8"]);
    expect(get("same-fare").why).toMatch(/under \$400: allowed as asked.*international.*only in economy/);
    expect(get("two-fares").sides.map((s) => s.uc)).toEqual(["UC7", "UC48"]);
    expect(get("two-fares").why).toContain("$380 is at or under $400");
    expect(get("careful-poisoned").why).toMatch(/\$2,500 business booking/);
    expect(get("careful-poisoned").why).toMatch(/over \$1,500, so a person must approve it/);
    expect(get("careful-poisoned").why).not.toMatch(/refuses it/);
    // the banking text of the same pair is unchanged
    expect(presetFor(PRESETS.find((p) => p.id === "careful-poisoned"), { cast: BANKING, prompts: [] }).why).toMatch(/Agent Authorize refuses it/);
    for (const p of presetsFor(AIRLINE)) { const f = presetFor(p, ctx); expect([f.title, f.why, ...f.sides.map((x) => x.label)].join(" ")).not.toMatch(/\{\{|UC\d/); }
  });
});
