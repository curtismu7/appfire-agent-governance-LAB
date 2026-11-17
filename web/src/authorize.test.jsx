// PingOne Authorize decided the airline booking (design-authorize-lab.md D.4, D.6): how the page READS the data the server sends. These are mapping tests from
// hand-written run fixtures; they prove the card, the captions, the lane and the approver word follow the data, and that a lab-policy run never borrows an Authorize word.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { decisionOf, riskLevelOf } from "./decision";
import { NO_DECISION_WORDS, approverOf, noDecisionWords } from "./fare";
import { AUTHORIZE_CAPTIONS, CAPTIONS, captionFor } from "./captions";
import { ACTORS, actorOf, actorsIn } from "./evidence/lanes";
import SequenceView from "./evidence/SequenceView";
import { replyOf } from "./chat";
import { outcomeState } from "./lib";
import { AUTH_BY, FULL_INFO, INFO, airlineAuthorizeBody, airlineRealBody, authorizeLine, mockApi } from "./testFixtures";

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const run = (k, r) => airlineAuthorizeBody(k, r).run;
const field = (d, key) => d.fields.find((f) => f.key === key)?.value;
const decisionHop = (r) => r.hops.find((h) => h.kind === "authorize-decision" && h.verdict !== "skip");
// The reader-visible strings of the page (own text nodes and the four attributes), minus the data panes, scanned for the five banned words (the walk of no-mock-words.test.jsx, reduced).
const DATA = [".jsonbox", ".json", ".jwire", ".http__url", ".http__line", ".fact__v", '[data-testid="claim-diff"]', '[data-testid="sdp-kv"]', "script", "style"];
const WORDS = /mock|simulat|offline|\bengine\b|scripted/i;
const offenders = (root) => {
  const bad = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (DATA.some((sel) => el.closest(sel))) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
    for (const t of [own, ...["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a) || "")]) if (WORDS.test(t.replace(/policy engine/gi, "").replace(/\bSimulate\b|\bScripted\b/g, ""))) bad.push(t.slice(0, 100));
  }
  return bad;
};
const BANNED = /mock|simulat|offline|\bengine\b|scripted|\bUC\d|\bchecked\b/i;
const cardText = (r) => { const d = decisionOf(r); return [d.word, d.reason, ...d.fields.map((f) => `${f.label} ${f.value}`), JSON.stringify(replyOf(r))].join("\n"); };

describe("the decision card when PingOne Authorize decided", () => {
  test.each([["permit", "ALLOWED", 1], ["constrained", "CONSTRAINED", 2], ["hold", "ESCALATED", 4], ["approved", "ALLOWED", 1]])("%s: the policy row is the server's line, verbatim", (kind, word, level) => {
    const r = run(kind);
    const d = decisionOf(r);
    expect(d.word).toBe(word);
    expect(d.level).toBe(level);
    expect(field(d, "policy")).toBe(authorizeLine(kind));
    expect(field(d, "policy")).toContain("PingOne Authorize (policy Larkspur Air Booking Authorization) returned PERMIT with the statement");
    expect(field(d, "policy")).toMatch(/the lab read that as .+ and applied it/);
    // Authorize returns PERMIT and a statement: the lab's own words (CONSTRAINED, HITL_REQUIRED, STEP_UP) are never put in its mouth
    expect(field(d, "policy")).not.toMatch(/returned (CONSTRAINED|HITL_REQUIRED|STEP_UP)/);
    expect(cardText(r)).not.toMatch(BANNED);
  });

  test("a narrowed booking keeps the CONSTRAINED card (info tone) and names Authorize in its reason", () => {
    const d = decisionOf(run("constrained"));
    expect(d).toMatchObject({ verdict: "constrained", tone: "info" });
    expect(d.reason).toContain("PingOne Authorize returned PERMIT with the statement airline-economy-intl; the lab read that as economy only");
    expect(d.reason).not.toMatch(/\$\d/); // the lab's own display figure is never put inside a sentence attributed to PingOne Authorize
    expect(field(d, "seat")).toBe("business asked, economy booked");
  });

  test("the same run with the line removed falls back to the composed row (the line is what makes it verbatim)", () => {
    const r = run("permit");
    delete decisionHop(r).decision.line;
    expect(field(decisionOf(r), "policy").startsWith(`${AUTH_BY}: `)).toBe(true);
  });
});

describe("the decision card when the lab policy decided (Authorize settings absent, or Authorize not asked)", () => {
  test.each(["permit", "constrained", "hold", "approved"])("%s: the policy row is unchanged and never says PingOne Authorize decided", (kind) => {
    const r = airlineRealBody(kind).run;
    const policy = field(decisionOf(r), "policy");
    expect(policy).toContain("lab policy (local), not PingOne Authorize");
    expect(policy).not.toMatch(/PingOne Authorize \(policy|returned|decided/);
    expect(cardText(r)).not.toMatch(/PingOne Authorize decided/);
  });
});

describe("NO DECISION", () => {
  test("a card that says NO DECISION, warn tone, no rung, never ALLOWED, DENIED or ESCALATED", () => {
    const r = run("nodecision", "timeout");
    const d = decisionOf(r);
    expect(d).toMatchObject({ verdict: "no-decision", word: "NO DECISION", tone: "warn", level: null });
    expect(d.reason).toBe("PingOne Authorize gave no decision: it did not reply in time. Nothing was booked, and the lab did not use its own rule instead.");
    expect(field(d, "policy")).toBe("PingOne Authorize gave no decision: it did not reply in time");
    expect(field(d, "decision")).toBe("no decision");
    expect(field(d, "seat")).toBe("business asked, not booked");
    expect(cardText(r)).not.toMatch(/ALLOWED|DENIED|ESCALATED|CONSTRAINED/);
    expect(cardText(r)).not.toMatch(BANNED);
    expect(riskLevelOf(r)).toBeNull();
    expect(outcomeState("REAL_NO_DECISION")).toBe("warn");
  });

  test("every reason of the server's table has its words, and each reaches the card", () => {
    for (const [reason, words] of Object.entries(NO_DECISION_WORDS)) {
      const d = decisionOf(run("nodecision", reason));
      expect(d.reason).toContain(`PingOne Authorize gave no decision: ${words}.`);
    }
    expect(Object.keys(NO_DECISION_WORDS)).toHaveLength(15);
  });

  test("a reason that is not in the table is never shown as sent (free text, a prototype key)", () => {
    for (const bad of ["<script>x</script>", "__proto__", "constructor", "", null, 7]) {
      expect(noDecisionWords(bad)).toBe("it gave no answer the lab could use");
      expect(decisionOf(run("nodecision", bad)).reason).not.toContain("<script>");
    }
  });
});

describe("who approves a held booking in the chat", () => {
  test("PingOne Authorize only when the data says it decided; the fare rule and Authorize otherwise", () => {
    expect(approverOf(run("hold"))).toBe("PingOne Authorize");
    expect(approverOf(airlineRealBody("hold").run)).toBe("Fare rule");
    expect(approverOf({ outcome: "HITL_REQUIRED", hops: [] })).toBe("Authorize");
    expect(approverOf({ decidedBy: "lab-policy-local", fareRule: {}, booking: {} })).toBe("Fare rule");
    expect(approverOf({ decidedBy: "none", fareRule: {}, booking: {} })).toBe("Fare rule");
  });
});

describe("captions", () => {
  test("a hop PingOne Authorize decided uses the Authorize words, by outcome", () => {
    const say = (k) => captionFor(decisionHop(run(k)));
    expect(say("permit")).toMatchObject({ say: AUTHORIZE_CAPTIONS.say, point: AUTHORIZE_CAPTIONS.point });
    expect(say("constrained").say).toBe(AUTHORIZE_CAPTIONS.constrained);
    expect(say("hold").say).toBe(AUTHORIZE_CAPTIONS.held);
    const denied = { ...decisionHop(run("permit")), verdict: "deny", decision: { outcome: "DENY", by: AUTH_BY } };
    expect(captionFor(denied).say).toBe(AUTHORIZE_CAPTIONS.deny);
    expect(captionFor(decisionHop(run("nodecision"))).say).toBe(AUTHORIZE_CAPTIONS.nodecision);
  });

  test("the strings are the ones of the design, word for word", () => {
    expect(AUTHORIZE_CAPTIONS.say).toBe("The tool server sent PingOne Authorize the booking: the fare, whether the trip is international, the cabin asked and whether a person has approved. PingOne Authorize answers with a decision and the tool server enforces it. The model has no say.");
    expect(AUTHORIZE_CAPTIONS.nodecision).toBe("PingOne Authorize gave no decision. The tool server booked nothing and did not use its own rule instead.");
    expect(AUTHORIZE_CAPTIONS.constrained).toBe("PingOne Authorize returned PERMIT with a statement the lab reads as: economy only. The tool server applies it, so the agent's ask for business is not granted. The rule is the policy the owner wrote in PingOne Authorize.");
    expect(AUTHORIZE_CAPTIONS.held).toContain("The approval itself runs on the lab's own approval service.");
    expect(AUTHORIZE_CAPTIONS.held).toContain("returned PERMIT");
    for (const v of Object.values(AUTHORIZE_CAPTIONS)) expect(v).not.toMatch(BANNED);
  });

  test("a lab-policy decision keeps the tool server's words, and CAPTIONS has no Authorize key added", () => {
    for (const k of ["permit", "constrained", "hold"]) {
      const c = captionFor(decisionHop(airlineRealBody(k).run));
      expect(Object.values(AUTHORIZE_CAPTIONS)).not.toContain(c.say);
    }
    expect(captionFor(decisionHop(airlineRealBody("permit").run)).say).toContain("the tool server applies its rules");
    expect(Object.keys(CAPTIONS)).not.toContain("nodecision");
    expect(CAPTIONS["authorize-decision"].say).toContain("policy engine");
  });

  test("decidedBy none alone is not Authorize's silence: a lab-policy run with no answer keeps the tool server's words", () => {
    const h = { ...decisionHop(airlineRealBody("permit").run), decidedBy: "none", verdict: "error", decision: { outcome: "NO ANSWER", by: "lab policy (local), not PingOne Authorize" } };
    expect(Object.values(AUTHORIZE_CAPTIONS)).not.toContain(captionFor(h).say);
  });

  test("the other hop kinds are untouched, and a skipped hop still says NOT RUN", () => {
    const toolHop = run("permit").hops.find((h) => h.kind === "tool-dispatched");
    expect(captionFor(toolHop).say).toBeTruthy();
    expect(captionFor({ ...decisionHop(run("permit")), verdict: "skip" }).notInPath).toBe(true);
  });
});

describe("the Authorize lane and the Sequence", () => {
  test("the lane is labelled PingOne Authorize (P1AZ) and its card says who asks it", () => {
    const decided = run("constrained").hops;
    expect(actorOf("authorize", decided)).toMatchObject({ label: "PingOne Authorize (P1AZ)", initials: "AZ", lane: "authorize" });
    expect(actorOf("authorize", decided).role).toContain("the gateway asks it");
    expect(actorOf("authorize", decided).role).toContain("the lab's tool server asks it directly");
    expect(actorOf("authorize", decided).sees).toContain("the fare");
    expect(actorOf("authorize", decided).never).toBe("the token itself");
    // a run PingOne Authorize was not asked in keeps the neutral lane name: no hops, a lab-rule hop, or a skipped one
    for (const hops of [undefined, [], [{ n: 1, kind: "authorize-decision", from: "bff", to: "authorize", verdict: "ok", decision: { outcome: "PERMIT", by: "the lab's fare rule, not a PingOne Authorize outcome" } }], [{ n: 1, kind: "authorize-decision", from: "gateway", to: "authorize", verdict: "skip", provider: "se" }]]) {
      expect(actorOf("authorize", hops).label).toBe("Authorize");
      expect(actorOf("authorize", hops).role).toContain("not a PingOne Authorize answer");
    }
    // an SE gateway run (the gateway asked PingOne Authorize) carries the P1AZ name
    expect(actorOf("authorize", [{ n: 1, kind: "authorize-decision", from: "gateway", to: "authorize", verdict: "ok", provider: "se", answeredBy: "Agent Gateway (SE)" }]).label).toBe("PingOne Authorize (P1AZ)");
    expect(ACTORS.authorize.label).toBe("Authorize");
  });

  test("a booking Authorize decided draws on the Authorize lane; a lab-policy booking does not", () => {
    const decided = run("constrained").hops;
    expect(actorsIn(decided)).toContain("authorize");
    render(<SequenceView hops={decided} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId("actor-authorize").textContent).toContain("PingOne Authorize (P1AZ)");
    const n = decisionHop(run("constrained")).n;
    expect(screen.getByTestId(`row-${n}`).querySelector(".sq-msg")).toBeTruthy();
    expect(screen.getByTestId(`row-${n}`).querySelector(".sq-note")).toBeNull();
    cleanup();
    const lab = airlineRealBody("constrained").run.hops;
    expect(actorsIn(lab)).not.toContain("authorize");
    render(<SequenceView hops={lab} selected={null} onSelect={() => {}} />);
    expect(screen.queryByTestId("actor-authorize")).toBeNull();
    const m = lab.find((h) => h.kind === "authorize-decision" && h.verdict !== "skip").n;
    expect(screen.getByTestId(`row-${m}`).querySelector(".sq-note")).toBeTruthy();
  });

  test("a run on the lab's own steps draws its fare-rule decision on a lane named plainly Authorize, never PingOne Authorize (P1AZ)", () => {
    const hops = [
      { n: 1, kind: "agent-reply", label: "Agent reply", title: "Agent reply", from: "agent", to: "bff", verdict: "ok" },
      { n: 2, kind: "authorize-decision", label: "Authorize", title: "Authorize", from: "bff", to: "authorize", verdict: "ok", decision: { outcome: "CONSTRAINED", by: "the lab's fare rule, not a PingOne Authorize outcome" } },
    ];
    render(<SequenceView hops={hops} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId("actor-authorize").textContent).toContain("Authorize");
    expect(screen.getByTestId("actor-authorize").textContent).not.toContain("P1AZ");
    expect(screen.getByTestId("sequence-svg").getAttribute("aria-label")).toBeTruthy();
    expect(document.body.textContent).not.toContain("PingOne Authorize (P1AZ)");
  });

  test("a no-decision hop is a note on the tool server lane, never an arrow to Authorize", () => {
    const hops = run("nodecision").hops;
    expect(actorsIn(hops)).not.toContain("authorize");
    render(<SequenceView hops={hops} selected={null} onSelect={() => {}} />);
    const n = decisionHop(run("nodecision")).n;
    expect(screen.getByTestId(`row-${n}`).querySelector(".sq-note")).toBeTruthy();
  });
});

// The whole page, with an Authorize-decided run and with a no-decision run on it: the card, the chat, the step detail and the Sequence say what the data says and
// none of the banned words, and a lab-policy run on the same page never says Authorize decided.
describe("the page reads an Authorize-decided run", () => {
  const boot = async (kind) => {
    const body = airlineAuthorizeBody(kind);
    const api = mockApi({ mode: "live", live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, realAnswer: () => body });
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe("live"));
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC1")); await u.click(screen.getByTestId("run")); await screen.findByTestId("decision-card");
    return { u, body };
  };
  const text = (id) => screen.getByTestId(id).textContent.replace(/\s+/g, " ");

  test("CONSTRAINED by PingOne Authorize: the policy row is the server's line; the Sequence has the lane; no banned word", async () => {
    const { u, body } = await boot("constrained");
    expect(text("decision-word")).toBe("CONSTRAINED");
    expect(text("decision-policy")).toContain(authorizeLine("constrained"));
    expect(screen.getByTestId("actor-authorize").textContent).toContain("PingOne Authorize (P1AZ)");
    await u.click(screen.getByTestId(`row-${decisionHop(body.run).n}`));
    await screen.findByTestId("step-detail");
    expect(text("step-detail")).toContain("Decided by");
    expect(text("step-detail")).toContain(AUTH_BY);
    expect(offenders(document.body)).toEqual([]);
  });

  test("NO DECISION: the card, the chat reply and the note on the tool server lane; nothing says ALLOWED, DENIED or ESCALATED", async () => {
    const { body } = await boot("nodecision");
    expect(text("decision-word")).toBe("NO DECISION");
    expect(text("decision-card")).not.toMatch(/ALLOWED|DENIED|ESCALATED/);
    expect(text("decision-policy")).toBe("PingOne Authorize gave no decision: it did not reply in time");
    expect(screen.queryByTestId("actor-authorize")).toBeNull();
    expect(screen.getByTestId(`row-${decisionHop(body.run).n}`).querySelector(".sq-note")).toBeTruthy();
    expect(offenders(document.body)).toEqual([]);
  });
});
