// The airline pack on a Real run (design-airline-real.md 5 and 6.1): the lab's own tool server narrows or holds a booking and the run says so in `constrained`,
// `booking` and `fareRule`. These are MAPPING tests: they prove how the card, the strip and the chat read that data, not how the tool server behaves.
import { describe, expect, test } from "vitest";
import { decisionOf, RISK_RUNGS, riskLevelOf } from "./decision";
import { constrainedPolicy, FARE_RUNGS, narrowedChip, riskRungsOf, seatFields } from "./fare";
import { replyOf } from "./chat";
import { captionFor } from "./captions";
import { outcomeState } from "./lib";
import { AIR_REASON_INTL, airlineRealBody } from "./testFixtures";

const BY = "lab policy (local), not PingOne Authorize";
const KINDS = ["read", "permit", "constrained", "hold", "approved", "rejected"];
const run = (k) => airlineRealBody(k).run;
const field = (d, key) => d.fields.find((f) => f.key === key)?.value;
// What the audience may read on the card: never these words, never a use case id, never "checked".
const BANNED = /mock|simulat|offline|\bengine\b|scripted|\bUC\d|\bchecked\b/i;
const cardText = (r) => { const d = decisionOf(r); return [d.word, d.reason, ...d.fields.map((f) => `${f.label} ${f.value}`), narrowedChip(r) || "", JSON.stringify(replyOf(r))].join("\n"); };

describe("a Real airline booking on the decision card", () => {
  test("REAL_CONSTRAINED: CONSTRAINED, info tone, policy row is the run's own words under the lab's own label, seat row, rung 2", () => {
    const r = run("constrained");
    const d = decisionOf(r);
    expect(d).toMatchObject({ verdict: "constrained", word: "CONSTRAINED", tone: "info", level: 2 });
    expect(field(d, "policy")).toBe(`${BY}: ${AIR_REASON_INTL}`);
    expect(field(d, "decision")).toBe("REAL_CONSTRAINED (CONSTRAINED)");
    expect(field(d, "seat")).toBe("business asked, economy booked");
    expect(d.reason).toBe(`Allowed with a limit: ${AIR_REASON_INTL}. The booking went through; the agent asked for business and was granted economy.`);
    expect(riskLevelOf(r)).toBe(2);
    expect(narrowedChip(r)).toBe("Narrowed: business to economy");
    expect(constrainedPolicy(r, undefined)).toMatchObject({ by: BY, decision: "CONSTRAINED" });
    expect(outcomeState("REAL_CONSTRAINED")).toBe("info");
  });

  test("REAL_PERMIT on a booking: ALLOWED, business asked and booked, rung 1, no chip", () => {
    const r = run("permit");
    const d = decisionOf(r);
    expect(d).toMatchObject({ verdict: "allowed", word: "ALLOWED", tone: "ok", level: 1 });
    expect(field(d, "seat")).toBe("business asked, business booked");
    expect(narrowedChip(r)).toBeNull();
    expect(replyOf(r).constrained).toBeUndefined();
  });

  test("REAL_HOLD (428): ESCALATED, rung 4, the seat row says not booked yet, the reply is the hold card", () => {
    const r = run("hold");
    const d = decisionOf(r);
    expect(d).toMatchObject({ verdict: "escalated", word: "ESCALATED", level: 4 });
    expect(field(d, "seat")).toBe("business asked, not booked yet (held)");
    expect(replyOf(r).approval.head).toBe("Held for approval");
    expect(r.booking.fare).toBe(2400);
  });

  test("a booking after the phone approved it: ALLOWED, booked as asked (business), no narrowing, reply starts Booked as approved", () => {
    const r = run("approved");
    const d = decisionOf(r);
    expect(d).toMatchObject({ verdict: "allowed", word: "ALLOWED" });
    expect(field(d, "seat")).toBe("business asked, business booked");
    expect(replyOf(r).text).toMatch(/^Booked as approved: /);
    expect(narrowedChip(r)).toBeNull();
  });

  test("REAL_RECEIPT_REJECTED: DENIED and the strip lights Refused (rung 5), not nothing", () => {
    const r = run("rejected");
    expect(decisionOf(r)).toMatchObject({ verdict: "denied", word: "DENIED", level: 5 });
    expect(riskLevelOf(r)).toBe(5);
    expect(field(decisionOf(r), "seat")).toBe("business asked, not booked");
  });

  test("a Real read (trips) is ALLOWED with no seat row; a software Real run keeps four rungs", () => {
    const r = run("read");
    expect(decisionOf(r)).toMatchObject({ verdict: "allowed", level: 1 });
    expect(seatFields(r)).toEqual([]);
    expect(riskRungsOf(r, RISK_RUNGS)).toBe(FARE_RUNGS);
    const sw = { ...r, vertical: "software" }; delete sw.fareRule;
    expect(riskRungsOf(sw, RISK_RUNGS)).toBe(RISK_RUNGS);
    expect(riskLevelOf({ kind: "real", outcome: "REAL_RECEIPT_REJECTED" })).toBe(4);
  });

  test("every airline Real run draws five rungs", () => {
    for (const k of KINDS) expect(riskRungsOf(run(k), RISK_RUNGS).length, k).toBe(5);
  });

  test("a constrained run whose reason is missing falls back to the rule name, never to an empty policy row", () => {
    const r = run("constrained");
    delete r.constrained.reason;
    expect(field(decisionOf(r), "policy")).toBe(`${BY}: lab-fare-constrained`);
  });

  test("the card text, the chip and the reply carry no mock/simulated/offline/engine/scripted word, no use case id and no 'checked'", () => {
    for (const k of KINDS) expect(cardText(run(k)), k).not.toMatch(BANNED);
  });

  test("the step captions on a narrowed Real booking name the narrowing and the lab's own rule; a booked-as-asked run keeps the plain ones", () => {
    const hops = (k) => run(k).hops;
    const dec = hops("constrained").find((h) => h.kind === "authorize-decision");
    const tool = hops("constrained").find((h) => h.kind === "tool-dispatched");
    expect(captionFor(dec).say).toMatch(/does not refuse/);
    expect(captionFor(dec).say).toMatch(/not a PingOne Authorize one/);
    expect(captionFor(tool).say).toMatch(/economy, not the business/);
    expect(captionFor(hops("permit").find((h) => h.kind === "tool-dispatched")).say).not.toMatch(/economy/);
    for (const h of [dec, tool]) expect(captionFor(h).say).not.toMatch(BANNED);
  });
});

describe("review fixes: what the card says is held, what the phone shows, what a caption calls a booking", () => {
  test("the seat row says (held) only for a hold; every other Real run that booked nothing says only not booked", () => {
    const hold = run("hold");
    expect(field(decisionOf(hold), "seat")).toBe("business asked, not booked yet (held)");
    for (const outcome of ["REAL_TOKEN_PROBLEM", "REAL_UNREACHABLE", "REAL_REFUSED", "REAL_DENY", "REAL_RECEIPT_REJECTED"]) {
      const r = { ...hold, outcome };
      const row = seatFields(r)[0].value;
      expect(row, outcome).toBe("business asked, not booked");
      expect(row, outcome).not.toMatch(/held/);
    }
    // a run that is not Real keeps its words
    expect(seatFields({ ...hold, outcome: "HITL_REQUIRED" })[0].value).toBe("business asked, not booked yet (held)");
  });

  test("the booking's allowed tool step is a booking, not a low-risk read", () => {
    const hop = { kind: "tool-dispatched", capability: "tools", source: "real", verdict: "ok", request: { calls: [{ body: { method: "tools/call", name: "book_airline_flight" } }] } };
    const c = captionFor(hop);
    expect(c.say).not.toMatch(/\bread\b/); expect(c.say).toMatch(/booking/);
    const read = captionFor({ ...hop, request: { calls: [{ body: { method: "tools/call", name: "get_airline_bookings" } }] } });
    expect(read.say).toMatch(/low-risk read/);
  });
});
