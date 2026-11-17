// Real on two providers (owner, 2026-11-16): the data says who answered (`hop.answeredBy`, a fixed string the server sends), the page shows it as a key fact
// in the step detail and never as a chip, a refusal the lab's own tool server made reads as lab policy, and the Run page draws no gateway panel for it.
// These are MAPPING tests: they prove how the page reads the server's data, not how PingOne, the SE gateway or the tool server behave.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import StepDetailPanel from "./evidence/StepDetailPanel";
import { answeredByOf, factsOf } from "./components/HttpMessage";
import { decisionOf, riskLevelOf } from "./decision";
import { replyOf } from "./chat";
import { captionFor } from "./captions";
import { actorOf } from "./evidence/lanes";
import * as lib from "./lib";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, mockApi, realBody } from "./testFixtures";

const LOCAL = "tool server (local)";
const BY = "lab policy (local), not PingOne Authorize";
const WORDS = /mock|simulat|offline|\bengine\b|scripted/i;

// A Real run answered by the lab's own tool server, shaped like the server's (provider and answeredBy on the hops the tool server answered, capability "tools" on
// every provider-side hop, the authorize-decision hop drawn as a note on the tool server's lane, no gatewayTrace).
const toolsRun = (id, { outcome = "REAL_PERMIT", stopAt = null, reply, challenge = null } = {}) => {
  const b = realBody(id, { outcome, stopAt, reply: reply || { who: "Tool server", text: "You have 8 issues (lab-invented data from the lab's own tool server)." } });
  const served = new Set(["gateway-check", "authorize-decision", "tool-dispatched", "tool-held", "tool-refused", "api-call"]);
  b.run.vertical = "software";
  b.run.real = { level: "full", tool: "get_my_issues", provider: "local" };
  b.run.provider = "local"; b.run.providerWhy = "auto-se-not-configured"; b.run.gatewayTrace = [];
  if (challenge) b.run.challenge = challenge;
  b.run.hops = b.run.hops.map((h) => (served.has(h.kind) ? {
    ...h, capability: "tools", ...(h.verdict === "skip" || h.source === "not-run" ? {} : { provider: "local", answeredBy: LOCAL }),
    ...(h.kind === "authorize-decision" ? { from: "toolserver", to: "toolserver", title: "Lab policy (local)", request: { tool: "get_my_issues", arguments: { limit: 5 } }, decision: { ...(h.decision || { outcome: "PERMIT" }), by: BY } } : {}),
  } : h));
  return b;
};

let api;
const answer = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const boot = async (state = {}) => {
  api = mockApi({ mode: "live", live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, ...state });
  vi.stubGlobal("fetch", api);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe("live"));
  return userEvent.setup();
};
const runUc = async (u, id) => { await u.click(screen.getByTestId(`uc-${id}`)); await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };
beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the step detail says who answered, from the hop's own data", () => {
  test("Answered by is the first key fact and Decided by follows the decision; a hop the lab ran itself shows neither", () => {
    const facts = factsOf({ answeredBy: LOCAL, response: { status: 403 }, decision: { outcome: "DENY", by: BY } });
    expect(facts.map((f) => f.label)).toEqual(["Answered by", "HTTP", "decision", "Decided by"]);
    expect(facts[0]).toMatchObject({ kind: "info", value: LOCAL });
    expect(facts[3]).toMatchObject({ kind: "info", value: BY });
    expect(factsOf({ response: { status: 200 } }).map((f) => f.label)).toEqual(["HTTP"]);
    expect(factsOf({ answeredBy: 7, decision: { outcome: "PERMIT", by: {} } }).map((f) => f.label)).toEqual(["decision"]);
  });

  test("a hop that did not run, or got no answer, names nobody even if a stale answeredBy is on it", () => {
    for (const hop of [{ answeredBy: LOCAL, source: "not-run", verdict: "skip" }, { answeredBy: LOCAL, verdict: "skip" }, { answeredBy: LOCAL, source: "real", verdict: "error" }]) {
      expect(factsOf(hop).some((f) => f.label === "Answered by")).toBe(false);
    }
    expect(answeredByOf({ answeredBy: LOCAL, source: "real", verdict: "ok" })).toBe(LOCAL);
    const dead = { n: 6, kind: "tool-dispatched", from: "toolserver", to: "toolserver", title: "Tool server (local)", verdict: "skip", source: "not-run", answeredBy: LOCAL, request: {}, response: {} };
    render(<StepDetailPanel hops={[dead]} selected={6} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Answered by")).toBeNull();
    expect(screen.queryByTestId("xch-answered-by")).toBeNull();
  });

  test("the page never invents the name: no answeredBy, no fact, even when a provider key is there", () => {
    expect(factsOf({ provider: "local", response: { status: 200 } }).some((f) => f.label === "Answered by")).toBe(false);
  });

  test("the step detail shows the fact (and no chip); the SE gateway's own string reads the same way", () => {
    const hop = { n: 6, kind: "tool-dispatched", from: "gateway", to: "mcp", title: "Tool server (local)", verdict: "ok", provider: "local", answeredBy: LOCAL, request: { tool: "get_my_issues" }, response: { status: 200 } };
    const { rerender } = render(<StepDetailPanel hops={[hop]} selected={6} onSelect={() => {}} onClose={() => {}} />);
    const facts = screen.getByTestId("key-facts");
    expect(within(facts).getByText("Answered by")).toBeTruthy();
    expect(within(facts).getByText(LOCAL)).toBeTruthy();
    expect(document.querySelector('[data-testid="hop-source"], [data-testid="hop-provider"]')).toBeNull();
    rerender(<StepDetailPanel hops={[{ ...hop, answeredBy: "Agent Gateway (SE)", provider: "se" }]} selected={6} onSelect={() => {}} onClose={() => {}} />);
    expect(within(screen.getByTestId("key-facts")).getByText("Agent Gateway (SE)")).toBeTruthy();
  });

  test("the per-call card view repeats it above its first card", () => {
    const req = (n, body) => ({ method: "POST", url: "http://127.0.0.1:1/mcp", headers: { "content-type": "application/json" }, body });
    const hop = { n: 5, kind: "gateway-check", from: "agent", to: "gateway", title: "Tool server (local)", verdict: "ok", provider: "local", answeredBy: LOCAL,
      request: { calls: [req(1, { method: "initialize" }), req(2, { method: "tools/list" })] }, response: { calls: [{ status: 200, body: {} }, { status: 200, body: { tools: [] } }] } };
    render(<StepDetailPanel hops={[hop]} selected={5} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId("xch-answered-by").textContent).toBe(`Answered by: ${LOCAL}`);
    const html = document.querySelector(".xch").innerHTML;
    expect(html.indexOf("xch-answered-by")).toBeLessThan(html.indexOf("xch-1"));
  });
});

describe("the decision card reads a tool server's own rule as lab policy", () => {
  test("a refusal the tool server made names the lab's policy, not PingOne Authorize or a gateway", () => {
    const run = toolsRun("UC6", { outcome: "REAL_DENY", stopAt: 5, reply: { who: "Tool server", text: "The tool server refused this request (HTTP 403, access_denied) under the lab's own policy (local), not PingOne Authorize. Nothing was run." } }).run;
    run.hops = run.hops.map((h) => (h.kind === "authorize-decision" ? { ...h, response: { status: 403, "x-gw-audit-trail": { decision: "DENY", source: "lab-policy", rule: "lab-band-deny" } } } : h));
    const d = decisionOf(run);
    expect(d).toMatchObject({ verdict: "denied", word: "DENIED" });
    expect(d.fields.find((f) => f.key === "policy").value).toBe(`${BY}: lab-band-deny`);
    expect(d.reason).not.toMatch(/Agent Authorize|the gateway/);
    expect(d.fields.find((f) => f.key === "tool").value).not.toBe("not reached in this run");
  });

  test("a tool the server did not list is NOT OFFERED in the tool server's words; an SE run is not given one", () => {
    const tools = toolsRun("UC21", { outcome: "REAL_NOT_LISTED", reply: { who: "Tool server", text: "The tool server did not offer it." } }).run;
    const d = decisionOf(tools);
    expect(d).toMatchObject({ verdict: "not-offered", word: "NOT OFFERED" });
    expect(d.reason).toMatch(/^The tool server did not offer the tool/);
    expect(d.reason).toMatch(/lab policy, not PingOne Authorize/);
    expect(d.fields.find((f) => f.key === "policy").value).toMatch(/tool server/);
    const se = realBody("UC21", { outcome: "REAL_NOT_LISTED" }).run;
    expect(decisionOf(se).verdict).toBe("guided");   // an SE run keeps the page's existing reading: the lab has not verified an SE decision, so it draws no decision card of its own
  });

  test("a tier use case whose delegated token had NO groups claim is not worded as a tier decision", () => {
    const run = toolsRun("UC21", { outcome: "REAL_NOT_LISTED", reply: { who: "Tool server", text: "x" } }).run;
    run.groupsClaim = "absent";
    const d = decisionOf(run);
    expect(d).toMatchObject({ verdict: "not-offered", word: "NOT OFFERED" });
    expect(d.reason).toMatch(/no tier decision can be read/);
    expect(d.reason).toMatch(/UNVERIFIED/);
    expect(d.fields.find((f) => f.key === "decision").value).toBe("no tier decision (groups claim absent)");
    run.groupsClaim = "present";
    expect(decisionOf(run).reason).toMatch(/lab policy, not PingOne Authorize/);
  });

  test("an SE gateway run is NOT given the lab's control ladder or a decision card of its own (only a tool server's own rule is)", () => {
    const se = realBody("UC8", { outcome: "REAL_HOLD", stopAt: 5 }).run;
    se.computed = false;
    expect(decisionOf(se)).toMatchObject({ verdict: "guided" });
    expect(riskLevelOf(se)).toBeNull();
    const tools = toolsRun("UC8", { outcome: "REAL_HOLD", stopAt: 5, reply: { who: "Tool server", approval: { head: "Held for approval", body: "x" } } }).run;
    tools.computed = false;
    expect(riskLevelOf(tools)).toBe(3);
  });

  test("the tool server's hops have their own lane and captions; the gateway's wording is not used for them", () => {
    expect(actorOf("toolserver").label).toBe("Tool server");
    expect(actorOf("toolserver").role).toMatch(/no gateway sits in front/);
    const hop = { kind: "authorize-decision", verdict: "deny", capability: "tools", source: "real" };
    expect(captionFor(hop).say).toMatch(/^The tool server says no\./);
    expect(captionFor({ ...hop, capability: undefined }).say).toMatch(/^The policy engine says no\./);
    expect(captionFor({ kind: "gateway-check", verdict: "ok", capability: "tools", source: "real" }).say).toMatch(/^The tool server checks the delegated token/);
    expect(captionFor({ kind: "tool-dispatched", verdict: "ok", capability: "tools", source: "real" }).say).toBe(captionFor({ kind: "tool-dispatched", verdict: "ok", source: "real" }).say);
    for (const k of ["authorize-decision", "gateway-check"]) for (const v of ["ok", "deny", "held"]) expect(captionFor({ kind: k, verdict: v, capability: "tools", source: "real" }).say).not.toMatch(/policy engine|gateway/i);
  });

  test("a refused approval receipt reads as DENIED, never as a pass", () => {
    const run = toolsRun("UC8", { outcome: "REAL_RECEIPT_REJECTED", stopAt: 5 }).run;
    const d = decisionOf(run);
    expect(d).toMatchObject({ verdict: "denied", word: "DENIED", tone: "bad" });
    expect(d.reason).toBe("The approval receipt was refused. Nothing was dispatched to the tool.");
    expect(riskLevelOf(run)).toBe(4);
  });

  test("a protected tool that answered without a token is a finding", () => {
    const d = decisionOf(toolsRun("UC24", { outcome: "REAL_NOT_REFUSED" }).run);
    expect(d).toMatchObject({ verdict: "finding", word: "FINDING", tone: "bad" });
    expect(d.reason).toBe("The protected tool answered without a token. A call with no token should be refused.");
  });

  test("a hold that needs a second factor sits on the second rung and says a second factor; a hold that needs a person stays on the third", () => {
    const stepUp = toolsRun("UC7", { outcome: "REAL_HOLD", reply: { who: "Tool server", approval: { head: "Held for step-up", body: "x" } } }).run;
    const person = toolsRun("UC8", { outcome: "REAL_HOLD", reply: { who: "Tool server", approval: { head: "Held for approval", body: "x" } } }).run;
    expect(riskLevelOf(stepUp)).toBe(2); expect(decisionOf(stepUp).reason).toMatch(/waits for a second factor/);
    expect(riskLevelOf(person)).toBe(3); expect(decisionOf(person).reason).toMatch(/waits for a person/);
  });

  test("the chat reply keeps the label the server sent: Tool server", () => {
    expect(replyOf(toolsRun("UC6", { outcome: "REAL_DENY", reply: { who: "Tool server", text: "refused" } }).run)).toMatchObject({ who: "Tool server", text: "refused" });
    expect(replyOf(toolsRun("UC8", { outcome: "REAL_HOLD", reply: { who: "Tool server", approval: { head: "Held for approval", body: "b" } } }).run)).toMatchObject({ who: "Tool server", approval: { head: "Held for approval" } });
  });
});

describe("the Run page for a tool server run", () => {
  test("a run the tool server answered draws no What Privilege did panel, shows Answered by in the step detail and reads in the tool server's voice", async () => {
    const u = await boot({ realAnswer: () => toolsRun("UC1") });
    await runUc(u, "UC1");
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    expect(screen.queryByRole("heading", { name: "What Privilege did" })).toBeNull();
    expect(screen.getByTestId("turn-who").textContent).toBe("Tool server");
    await u.click(screen.getByTestId("row-6"));
    expect(within(await screen.findByTestId("key-facts")).getByText(LOCAL)).toBeTruthy();
    // the Sequence has no Authorize lane for this run: the decision hop is a note on the Gateway lane
    expect(within(screen.getByTestId("sequence-view")).queryByText(/Authorize/)).toBeNull();
  });

  test("the words on the page for such a run pass the no-mock-words rule (the data panes are skipped, as in the page walk)", async () => {
    const u = await boot({ realAnswer: () => toolsRun("UC1") });
    await runUc(u, "UC1");
    await u.click(screen.getByTestId("row-6"));
    const DATA = [".jsonbox", ".json", ".jwire", ".http__url", ".http__line", ".fact__v", '[data-testid="claim-diff"]', '[data-testid="sdp-kv"]', "script", "style"];
    const bad = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (DATA.some((s) => el.closest(s))) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
      for (const v of [own, el.getAttribute("aria-label"), el.getAttribute("title")]) if (v && WORDS.test(v.replace(/policy engine/gi, "").replace(/\bSimulate\b/g, "").replace(/\bScripted\b/g, ""))) bad.push(v.trim().slice(0, 80));
    }
    expect(bad).toEqual([]);
  });

  test("a hold the tool server minted opens the phone and tells the server which service minted it", async () => {
    const hold = toolsRun("UC8", { outcome: "REAL_HOLD", stopAt: 5, challenge: "chal-1", reply: { who: "Tool server", approval: { head: "Held for approval", body: "The tool server answered 428." } } });
    const u = await boot({ realAnswer: () => hold });
    await runUc(u, "UC7");
    await screen.findByTestId("mock-phone-dialog");
    const start = api.calls.filter((c) => c.path === "/api/approval/start");
    expect(start).toHaveLength(1);
    expect(start[0].body).toMatchObject({ kind: "real", challengeId: "chal-1", provider: "local" });
  });

  test("a hold an SE gateway minted sends no provider unless the run carries one of the two fixed words", async () => {
    const se = realBody("UC8", { outcome: "REAL_HOLD", reply: { who: "Authorize", approval: { head: "Held for approval", body: "b" } } });
    se.run.challenge = "chal-2";
    let u = await boot({ realAnswer: () => se });
    await runUc(u, "UC7");
    await screen.findByTestId("mock-phone-dialog");
    expect(api.calls.find((c) => c.path === "/api/approval/start").body).not.toHaveProperty("provider");
    cleanup(); vi.unstubAllGlobals(); forgetWorkspace();
    const odd = realBody("UC8", { outcome: "REAL_HOLD", reply: { who: "Authorize", approval: { head: "Held for approval", body: "b" } } });
    odd.run.challenge = "chal-3"; odd.run.provider = "elsewhere";
    u = await boot({ realAnswer: () => odd });
    await runUc(u, "UC7");
    await screen.findByTestId("mock-phone-dialog");
    expect(api.calls.find((c) => c.path === "/api/approval/start").body).not.toHaveProperty("provider");
  });
});

describe("the software vertical is no longer described as mock-only", () => {
  test("OWN_TOOL_VERTICALS replaces MOCK_ONLY_VERTICALS", () => {
    expect(lib.OWN_TOOL_VERTICALS).toEqual(["software"]);
    expect(lib.MOCK_ONLY_VERTICALS).toBeUndefined();
  });

  test("no visible sentence says the software vertical, or any use case, cannot run the live chain, and no source file keeps the old name", () => {
    const dir = path.resolve(__dirname);
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(jsx?|css)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(f); } };
    walk(dir);
    const OLD = /live chain|no use case runs|does not run the live|serves no tool|gateway does not serve|Real runs need|Banking first|MOCK_ONLY/i;
    const hits = files.filter((f) => OLD.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(dir, f));
    expect(hits).toEqual([]);
  });
});
