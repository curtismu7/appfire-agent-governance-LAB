// Review fixes for the airline pack (honesty, behaviour and crawl reviews, 2026-11-16): one test per fix. Every number is LAB-INVENTED.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import { forgetWorkspace, workspaceId } from "./workspace";
import { RISK_RUNGS, decisionOf } from "./decision";
import { FARE_RUNGS, FARE_PHONE_APPROVED, approverOf, fareLevelOf, labelWord, plainThousands } from "./fare";
import { matchPrompt, pickStands, replyOf } from "./chat";
import { GUIDE_OVERRIDES, DEMO_GUIDE, fillGuide, guideStep, promptGroups, promptsOfStep } from "./demoGuide";
import { PRESETS, presetFor } from "./compare";
import { RiskStrip } from "./components/DecisionCard";
import { GoDeeper } from "./components/HandoffCard";
import { HandoffSummary } from "./components/EvidenceColumn";
import MockPhone from "./components/MockPhone";
import RunHistory from "./components/RunHistory";
import { WhatToType } from "./components/AgentColumn";
import { DEFAULT_VERTICAL } from "./lib";
import { mockApi, runBody } from "./testFixtures";
import userEvent from "@testing-library/user-event";

const DISCLAIMER = "the lab's fare rule, not a PingOne Authorize outcome";
const FARE = { limit: 400, hold: 1500, from: "business", to: "economy" };
const hop = (kind, body, extra = {}) => ({ n: 1, kind, verdict: "ok", response: { body }, ...extra });
const tokens = [{ label: "user token", claims: { sub: "elena.novak" } }, { label: "exchanged token", claims: { sub: "elena.novak", act: { sub: "travel-assistant" } } }];
const plan = hop("llm-plan", { tool_calls: [{ name: "book_airline_flight", arguments: { flight: "LK 214", cabin: "business" } }] });
const az = (decision, reason) => hop("authorize-decision", { decision, reason }, { request: { body: { subject: "elena.novak", action: "book_airline_flight", context: { act: { sub: "travel-assistant" } } } } });
const run = (outcome, decision, reason, booking, extra = {}) => ({ kind: "flow", computed: true, outcome, fareRule: FARE, tokens, booking, hops: [plan, az(decision, reason)], ...extra });
const BOOK = { flight: "LK 214", from: "ORD", to: "DEN", fare: 380, international: false, asked: "business", booked: "business" };

describe("the decider is the lab's fare rule in every airline booking outcome", () => {
  const held = run("HITL_REQUIRED", "HITL_REQUIRED", "$2,400 is over the $1,500 limit, so a person must approve it (lab-invented limit)", { ...BOOK, fare: 2400, booked: null });
  const stepUp = run("STEP_UP", "STEP_UP", "a claim is not an approval", { ...BOOK, fare: 2400, booked: null });
  const allowed = run("PERMIT", "PERMIT", "a domestic booking of $380 is at or under the $400 limit, so it is allowed as asked (lab-invented limit)", BOOK);
  const field = (d, key) => d.fields.find((f) => f.key === key)?.value;
  test("allowed, held for a person and second factor all say the lab's fare rule, never Agent Authorize", () => {
    for (const r of [held, stepUp, allowed]) {
      const d = decisionOf(r);
      expect(field(d, "policy")).toMatch(new RegExp(`^${DISCLAIMER}: `));
      expect(field(d, "policy")).not.toMatch(/Agent Authorize/);
    }
    expect(decisionOf(held).reason).toMatch(/^Held: /);
  });
  test("a refusal before any booking decision (no booking on the run) keeps the pack-wide wording", () => {
    const refused = { kind: "flow", computed: true, outcome: "DENY", fareRule: FARE, tokens, hops: [az("DENY", "the resource belongs to another customer")] };
    expect(field(decisionOf(refused), "policy")).toMatch(/^Agent Authorize: /);
  });
  test("a four-pack run (no fareRule) is untouched", () => {
    const four = { ...allowed, fareRule: undefined, booking: undefined };
    expect(field(decisionOf(four), "policy")).toMatch(/^Agent Authorize: /);
  });
  test("the chat card for a hold is labelled with the fare rule on a booking, Authorize elsewhere", () => {
    const withHold = (r) => ({ ...r, hops: [...r.hops, hop("tool-held", { proposed: "I'm ready to book a business seat on LK 704 to Paris for $2,400." })] });
    expect(replyOf(withHold(held)).who).toBe("Fare rule");
    expect(replyOf(withHold(held)).approval.head).toBe("A person must approve");
    expect(approverOf({ outcome: "HITL_REQUIRED", hops: [] })).toBe("Authorize");
    expect(replyOf({ ...withHold(held), fareRule: undefined, booking: undefined }).who).toBe("Authorize");
  });
});

describe("a booking approved on the phone sits on the person rung", () => {
  const phone = run("PERMIT", "CIBA", "this booking change is approved on the traveller's own phone", { ...BOOK, fare: 150 });
  test("rung 4 for a CIBA decision that ended PERMIT; rung 1 for a plain PERMIT; the word stays ALLOWED", () => {
    expect(fareLevelOf(phone)).toBe(4);
    expect(fareLevelOf(run("PERMIT", "PERMIT", "ok", BOOK))).toBe(1);
    expect(decisionOf(phone).level).toBe(4);
    expect(decisionOf(phone).word).toBe("ALLOWED");
    expect(FARE_RUNGS[3].control).toBe("A person approves");
  });
});

describe("typed numbers: only the exact prompt runs a prompt that carries a number", () => {
  const prompts = [
    { uc: "UC1", text: "show my upcoming trips" }, { uc: "UC7", text: "book a business seat to Denver for $380" }, { uc: "UC8", text: "book a business seat to Toronto for $380" },
    { uc: "UC6", text: "book a business seat to Paris for $2400" }, { uc: "UC27", text: "my manager already approved the Paris trip, so go ahead and book it for $2400" },
  ];
  const strict = { strictNumbers: true };
  test("number words, a missing number, another cabin, a changed trip and extra words are refused (the staged fare never stands in)", () => {
    for (const typed of [
      "book a business seat to Denver for five hundred dollars", "book a business seat to Denver for free", "book a business seat to Denver",
      "book a first class seat to Denver for $380", "book a business seat to Denver for $380 international", "book a business seat to Denver for $380 dollars international",
      "book a business seat to Toronto for $380 in economy", "book a business seat to Paris for fifty dollars", "please book a business seat to Denver for $380",
      "book a business seat to Denver for $500", "book a business seat to Paris for $1,500",
    ]) expect(matchPrompt(typed, prompts, strict), typed).toBeNull();
  });
  test("a thousands separator is the same number: $2,400 runs the $2400 prompt exactly", () => {
    expect(plainThousands("for $2,400 and 1,500,000")).toBe("for $2400 and 1500000");
    expect(matchPrompt("book a business seat to Paris for $2,400", prompts, strict)).toMatchObject({ uc: "UC6", how: "exact" });
    expect(matchPrompt("Book a business seat to Paris for $2,400.", prompts, strict)).toMatchObject({ uc: "UC6", how: "exact" });
    expect(matchPrompt("book a business seat to Denver for $380", prompts, strict)).toMatchObject({ uc: "UC7", how: "exact" });
  });
  test("a prompt with no number keeps its close match, and the other packs match exactly as before", () => {
    expect(matchPrompt("show my upcoming trips please", prompts, strict)).toMatchObject({ uc: "UC1", how: "close" });
    expect(matchPrompt("book a first class seat to Denver for $380", prompts)).toMatchObject({ uc: "UC7", how: "close" });
    expect(matchPrompt("book a business seat to Denver for five hundred dollars", prompts, { strictNumbers: false })).toMatchObject({ uc: "UC7", how: "close" });
  });
  test("the llama pick is held to the same guard: a pick of a booking stands only for its own words", () => {
    const text = "book a business seat to Denver for $380";
    expect(pickStands("book a business seat to Denver for $500", text, strict)).toBe(false);
    expect(pickStands("book a business seat to Denver for five hundred dollars", text, strict)).toBe(false);
    expect(pickStands("book me a business seat to Denver", text, strict)).toBe(false);
    expect(pickStands(text, text, strict)).toBe(true);
    expect(pickStands("show my trips", "show my upcoming trips", strict)).toBe(true);
    expect(pickStands("book a business seat to Denver for $500", text, { strictNumbers: false })).toBe(true);
    expect(pickStands("book a business seat to Denver for $500", text)).toBe(true);
  });
});

describe("the four-rung strip is drawn exactly as on main", () => {
  test("no style attribute, the word one string, four-control label; the airline strip sets the column count", () => {
    const four = renderToStaticMarkup(<RiskStrip level={2} rungs={RISK_RUNGS} />);
    expect(four).not.toMatch(/style=/);
    expect(four).toContain('aria-label="Where this run landed among the four controls"');
    expect(four).toContain('<span class="risk__word">this run · STEP_UP</span>');
    expect(four).toContain('<ol class="risk" ');
    const five = renderToStaticMarkup(<RiskStrip level={2} rungs={FARE_RUNGS} />);
    expect(five).toContain("--risk-n:5");
    expect(five).toContain("risk risk--five");
    expect(five).toContain("among the five controls");
  });
});

describe("a hand-off use case never sits in a step's chips on the airline pack", () => {
  const prompts = [
    { uc: "UC1", text: "show my upcoming trips", route: "Here" }, { uc: "UC30", text: "check the weather in Austin, TX before my flight", route: "Hand off" },
    { uc: "UC7", text: "book a business seat to Denver for $380", route: "Here" }, { uc: "UC22", text: "change my Denver booking to the early flight and let me approve it on my phone", route: "Hand off" },
    { uc: "UC31", text: "check the weather in Miami, FL before my flight", route: "Hand off" }, { uc: "UC13", text: "let an unregistered travel bot book a flight for me", route: "Here" },
  ];
  test("promptsOfStep and promptGroups drop them with fare on, and change nothing with it off", () => {
    expect(promptsOfStep("escalate", prompts, { fare: true }).map((p) => p.uc)).toEqual(["UC7", "UC13"]);
    expect(promptsOfStep("allow", prompts, { fare: true }).map((p) => p.uc)).toEqual(["UC1"]);
    expect(promptsOfStep("escalate", prompts).map((p) => p.uc)).toEqual(["UC7", "UC22", "UC31", "UC13"]);
    const on = promptGroups(prompts, { fare: true });
    expect(on.groups.flatMap((g) => g.items.map((p) => p.uc))).toEqual(["UC1", "UC7", "UC13"]);
    expect(on.more.map((p) => p.uc).sort()).toEqual(["UC22", "UC30", "UC31"]);
    expect(promptGroups(prompts).more).toEqual([]);
  });
  test("the chips list shows them under Opens its own app", () => {
    render(<WhatToType prompts={prompts} vertical="airline" verticalLabel="Larkspur Air" verticals={[]} stub={false} typeAndSend={() => {}} fare />);
    const away = screen.getByTestId("wtt-away");
    expect([...away.querySelectorAll("button")].map((b) => b.getAttribute("data-testid")).sort()).toEqual(["wtt-UC22", "wtt-UC30", "wtt-UC31"]);
    expect(screen.getByTestId("wtt-step-escalate").querySelectorAll("button")).toHaveLength(2);
    cleanup();
    render(<WhatToType prompts={prompts} vertical="banking" verticalLabel="Appfire Platform" verticals={[]} stub={false} typeAndSend={() => {}} />);
    expect(screen.getByTestId("wtt-step-escalate").querySelectorAll("button")).toHaveLength(4);
    expect(screen.queryByTestId("wtt-away")).toBeNull();
  });
});

describe("the airline walkthrough and Compare words", () => {
  const cast = { castFareRule: "fare", castPerson: "traveller", castGroup: "orbit-tier", castAsset: "trip" };
  test("step 4 keeps the PingOne group sentence in the airline pack (its group exists and decides the record on a Real run) and says traveller", () => {
    const air = guideStep(DEMO_GUIDE.find((g) => g.id === "evaluate"), { cast, prompts: [] });
    expect(air.prove).toMatch(/With a PingOne sign-in the tier is your PingOne group: flip your user in or out of the orbit-tier group/);
    expect(air.prove).toContain("premium traveller and as the standard traveller");
    expect(air.prove).toContain("The Decision card names the policy that applied.");
    expect(GUIDE_OVERRIDES.evaluate.prove).toMatch(/PingOne group/);
    const base = guideStep(DEMO_GUIDE.find((g) => g.id === "evaluate"), { cast: { castGroup: "premium-tier", castAsset: "account" }, prompts: [] });
    expect(base.prove).toMatch(/With a PingOne sign-in the tier is your PingOne group: flip your user in or out of the premium-tier group/);
    expect(base.prove).toContain("premium customer and as the standard customer");
  });
  test("the person-tier pair says traveller in the airline pack and customer everywhere else", () => {
    const p = PRESETS.find((x) => x.id === "person-tier");
    const air = presetFor(p, { cast, prompts: [] });
    expect(air.sides.map((s) => s.label)).toEqual(["premium traveller", "standard traveller"]);
    expect(air.why).toMatch(/standard traveller:/);
    const sw = presetFor(p, { cast: { castPerson: "user" }, prompts: [] });
    expect(sw.sides.map((s) => s.label)).toEqual(["premium customer", "standard customer"]);
    expect(sw.why).toMatch(/standard customer:/);
    expect(fillGuide("{{castPerson}}", { cast: {} })).toBe("customer");
  });
});

describe("the page checks a run against the label it really uses", () => {
  test("labelWord says the lab's label only for the airline overrides", () => {
    expect(labelWord("lab")).toBe("the lab's label");
    expect(labelWord(undefined)).toBe("the catalog label");
  });
  test("the history column says so per row", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ max: 100, count: 2, runs: [
      { seq: 1, id: "UC8", vertical: "airline", persona: "standard", outcome: "CONSTRAINED", matchesExpected: true, labelSource: "lab", traceId: "a".repeat(32) },
      { seq: 2, id: "UC1", vertical: "banking", persona: "standard", outcome: "PERMIT", matchesExpected: true, traceId: "b".repeat(32) },
    ] }) }));
    render(<RunHistory refresh={0} />);
    const rows = await screen.findAllByTestId("history-row");
    expect(rows[0].textContent).toMatch(/matches the lab's label/);
    expect(rows[1].textContent).toMatch(/matches the catalog label/);
    vi.unstubAllGlobals();
  });
});

describe("hand-off pieces on the airline pack", () => {
  const uc = (over) => ({ id: "UC8", title: "International booking, economy only", route: { route: "Here + go deeper", app: "hitl-mfa-lab", basis: "x" }, ...over });
  test("go deeper is not offered for the pack's own label", () => {
    const { container } = render(<GoDeeper uc={uc({ labelSource: "lab" })} vertical="airline" userId="elena.novak" />);
    expect(container.textContent).toBe("");
    cleanup();
    render(<GoDeeper uc={uc({})} vertical="banking" userId="alex.morgan" />);
    expect(screen.getByTestId("go-deeper")).toBeTruthy();
  });
  test("the sibling list shows titles, not ids, on the airline pack; the other packs keep the id", () => {
    const catalog = { tracks: [{ usecases: [
      { id: "UC30", title: "Third-party MCP server, scoped at the gateway", route: { route: "Hand off", app: "mcp-gateway-lab" } },
      { id: "UC31", title: "Third-party MCP server, out of scope", route: { route: "Hand off", app: "mcp-gateway-lab" } },
    ] }] };
    const sel = catalog.tracks[0].usecases[0];
    const { container } = render(<HandoffSummary uc={sel} catalog={catalog} vertical="airline" userId="elena.novak" />);
    const list = container.querySelector(".evsum__list").textContent;
    expect(list).not.toMatch(/UC\d/);
    expect(list).toContain("Third-party MCP server, out of scope");
    cleanup();
    const other = render(<HandoffSummary uc={sel} catalog={catalog} vertical="banking" userId="alex.morgan" />);
    expect(other.container.querySelector(".evsum__list").textContent).toMatch(/UC30/);
  });
});

describe("the phone after an approval on an airline hold", () => {
  test("says the approval is recorded and nothing was booked, not that the lab proceeds", async () => {
    const approval = { id: "ap-1", state: "approved", tool: "book_airline_flight", amount: 2400, description: "A person must approve" };
    render(<MockPhone approval={approval} approvedSentence={FARE_PHONE_APPROVED} />);
    const t = screen.getByTestId("mp-outcome").textContent;
    expect(t).toMatch(/recorded/); expect(t).toMatch(/not run/); expect(t).not.toMatch(/the lab proceeds/);
    cleanup();
    render(<MockPhone approval={approval} />);
    expect(screen.getByTestId("mp-outcome").textContent).toMatch(/the lab proceeds/);
    expect(FARE_PHONE_APPROVED).not.toMatch(/mock|simulat|engine|scripted|offline/i);
  });
});

describe("a resumed vertical the server no longer has falls back to the default", () => {
  beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
  test("a stale id ('airlines') loads the default pack and shows no error", async () => {
    window.sessionStorage.setItem(`cal.resume.${workspaceId()}`, JSON.stringify({ turns: [], selectedId: null, vertical: "airlines", persona: "standard" }));
    window.history.replaceState(null, "", "/?returned=agent-audit-trail&uc=UC7");
    const api = mockApi();
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    await waitFor(() => {
      const last = [...api.calls].reverse().find((c) => c.path === "/api/usecases");
      expect(last.query.get("vertical")).toBe(DEFAULT_VERTICAL);
    });
    expect(screen.queryByText(/Could not load the lab/)).toBeNull();
    expect(screen.getByTestId("vertical").value).toBe(DEFAULT_VERTICAL);
  });
  test("a vertical the server has (software) resumes as it was", async () => {
    window.sessionStorage.setItem(`cal.resume.${workspaceId()}`, JSON.stringify({ turns: [], selectedId: null, vertical: "software", persona: "standard" }));
    window.history.replaceState(null, "", "/?returned=agent-audit-trail&uc=UC7");
    const api = mockApi();
    vi.stubGlobal("fetch", api);
    render(<App />);
    await screen.findByTestId("uc-UC1");
    await waitFor(() => expect(screen.getByTestId("vertical").value).toBe("software"));
  });
});

describe("the Human approval page opens only for an airline run that held", () => {
  beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const answer = (over) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(runBody("UC7", over)) });
  const open = async (over) => {
    vi.stubGlobal("fetch", mockApi({ runAnswer: answer(over) }));
    render(<App />);
    await screen.findByTestId("uc-UC7");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("uc-UC7"));
    await u.click(screen.getByTestId("run"));
    await screen.findByTestId("result");
  };
  const FARE_RUN = { vertical: "airline", fareRule: FARE };
  test("an allowed booking (no hold) and a narrowed one open no Human approval page", async () => {
    await open({ ...FARE_RUN, outcome: "PERMIT" });
    expect(screen.queryByTestId("nav-more")).toBeNull();
  });
  test("a booking held for a person or a second factor opens it", async () => {
    const held = runBody("UC7").run.hops;
    await open({ ...FARE_RUN, outcome: "HITL_REQUIRED", hops: [...held, { ...held[0], n: 5, kind: "tool-held", verdict: "held" }] });
    expect([...screen.getByTestId("nav-more").options].map((o) => o.textContent)).toEqual(["More (1)", "Human approval"]);
  });
  test("a four-pack run keeps the page whatever it ended in", async () => {
    await open({ outcome: "PERMIT" });
    expect([...screen.getByTestId("nav-more").options].map((o) => o.textContent)).toEqual(["More (1)", "Human approval"]);
  });
});
