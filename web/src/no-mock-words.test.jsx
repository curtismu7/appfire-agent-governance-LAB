// The page says nothing about how it runs (owner, 2026-11-16: "Get rid of the mock calls, everything should be real mode. Stop calling out mock, demo
// watchers do not need to know."). This walks every page a visitor can reach, with a run on it, in a lab that opened in Real and in one that opened on the
// lab's own engine, and fails on the words mock, simulat*, offline, engine and scripted in anything a person can read: text, aria-label, title,
// placeholder, alt, an input's value and option text.
//
// The EXCEPTIONS are listed here, by name, so each one shows up in review:
//   DATA     raw JSON panes, hop URL lines and decoded claim values show the wire: hostnames such as idp.mock.example, audience customer-app-mock, kid
//            mock-key-1, bodies the lab sent. They are data, not labels (owner answer 4).
//   Q3       "lab-simulated" (the UC15 chip and its message) is an honesty admission the owner kept (answer 3).
//   Q4       the brain's name "Scripted" and the hand-off app id mock-authorize are names the owner kept (answer 4).
//   RULE 5   the diagram's "Simulate" control keeps the rulebook's name for it (rule 5 is the owner's file; see docs/rulebook-amendments.md).
//   TERM     "policy engine" is a product term.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { BANNER_HOSTED_TEXT, BANNER_LOCAL_TEXT, FULL_INFO, INFO, denyBody, mockApi, mockInRealBody, runBody } from "./testFixtures";

const WORDS = /mock|simulat|offline|\bengine\b|scripted/i;
const DATA = [".jsonbox", ".json", ".jwire", ".http__url", ".http__line", ".fact__v", '[data-testid="claim-diff"]', '[data-testid="sdp-kv"]', "script", "style"];
const EXCEPTIONS = [/lab-simulated/g, /\bScripted\b/g, /mock-authorize/g, /\bSimulate\b/g, /policy engine/gi];
const ATTRS = ["aria-label", "title", "placeholder", "alt"];

// Every reader-visible string under `root`, with where it came from. jsdom has no innerText, so own text nodes stand in for it.
export function readable(root) {
  const out = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (DATA.some((sel) => el.closest(sel))) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
    if (own) out.push({ where: `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} text`, text: own });
    for (const a of ATTRS) if (el.getAttribute(a)) out.push({ where: `${el.tagName.toLowerCase()} ${a}`, text: el.getAttribute(a) });
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName) && el.value && el.type !== "password") out.push({ where: `${el.tagName.toLowerCase()} value`, text: el.value });
  }
  return out;
}
export const offenders = (root) => readable(root).filter(({ text }) => WORDS.test(EXCEPTIONS.reduce((t, re) => t.replace(re, ""), text))).map(({ where, text }) => `${where}: ${text.slice(0, 140)}`);
const walk = (label) => { const bad = offenders(document.body); expect(bad, `${label}: ${bad.join("\n")}`).toEqual([]); };

let api;
const boot = async (state = {}, { hosted = false } = {}) => {
  api = mockApi({ ...(hosted ? { info: { hosted: true, hostedBanner: BANNER_HOSTED_TEXT } } : {}), ...state });
  vi.stubGlobal("fetch", api);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe(state.mode || "mock"));
  return userEvent.setup();
};
const runUc = async (u, id) => { await u.click(screen.getByTestId(`uc-${id}`)); await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };
beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the walk itself", () => {
  test("it finds a banned word in text and in each attribute, and skips the named exceptions", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p>a mock label</p><button aria-label="Run in mock">x</button><span title="the engine">y</span><input placeholder="offline" value="scripted"><img alt="simulated"><p>lab-simulated, Scripted, mock-authorize, Simulate, policy engine</p><pre class="json">idp.mock.example</pre>';
    expect(offenders(host).map((x) => x.split(":")[0])).toEqual(["p text", "button aria-label", "span title", "input placeholder", "input value", "img alt"]);
  });
});

describe("no mock, simulated, offline, engine or scripted word on any page", () => {
  test("Agent page: a run, the Why list, all four evidence tabs, a step detail, Quick Config and the Demo guide (opened on the lab's own engine)", async () => {
    const u = await boot();
    expect(screen.getByTestId("banner").textContent).toBe(BANNER_LOCAL_TEXT);
    walk("before a run");
    await runUc(u, "UC1");
    walk("after a run");
    await u.click(screen.getByTestId("row-1"));
    walk("step detail");
    for (const tab of ["reel", "topology", "tokens", "sequence"]) { await u.click(screen.getByTestId(`evtab-${tab}`)); walk(`${tab} tab`); }
    await u.click(screen.getByTestId("qc-open")); await screen.findByTestId("quick-config"); walk("Quick Config");
    await u.click(screen.getByTestId("qc-close"));
    await u.click(screen.getByTestId("help-link")); await screen.findByTestId("demo-guide"); walk("Demo guide");
  });

  test("a held use case: the approval card, and the phone with its dialog open", async () => {
    const u = await boot({ runAnswer: (id) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(runBody(id, { outcome: "HITL_REQUIRED" })) }) });
    await runUc(u, "UC7");
    await screen.findByTestId("turn-approval");
    await screen.findByTestId("mock-phone-dialog");
    walk("held run with the phone open");
  });

  test("a guided run and a run the gateway cannot serve (shown like any other)", async () => {
    const u = await boot();
    await u.click(screen.getByTestId("uc-UC-LEARN2")); await u.click(screen.getByTestId("run")); await screen.findByTestId("result");
    walk("guided run");
    cleanup(); vi.unstubAllGlobals();
    const u2 = await boot({ mode: "live", live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, realAnswer: (id) => mockInRealBody(id) });
    await runUc(u2, "UC1");
    walk("a Real-opened lab, run on the gateway-less path");
  });

  test("a Real-opened lab: the sign-in dialog and a Real run", async () => {
    const u = await boot({ mode: "live", live: "allowed", full: true, password: "typed-7-by-hand", info: { ...INFO, ...FULL_INFO } });
    await u.click(screen.getByTestId("uc-UC1")); await u.click(screen.getByTestId("run"));
    await screen.findByTestId("signin-dialog");
    walk("sign-in dialog");
    await u.type(screen.getByTestId("signin-password"), "typed-7-by-hand");
    await u.click(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe("REAL_PERMIT"));
    walk("a Real run");
    await u.click(screen.getByTestId("evtab-tokens")); walk("Real tokens");
  });

  test("a run the lab's own tool server answered: the page, every step detail (Answered by, Decided by) and the tokens", async () => {
    const served = new Set(["gateway-check", "authorize-decision", "tool-dispatched", "tool-held", "tool-refused", "api-call"]);
    const b = denyBody("UC1");
    b.run.provider = "local"; b.run.gatewayTrace = []; b.run.reply = { who: "Tool server", text: "The tool server refused this request (HTTP 403, access_denied) under the lab's own policy (local), not PingOne Authorize. Nothing was run." };
    b.run.hops = b.run.hops.map((h) => (served.has(h.kind) ? { ...h, provider: "local", answeredBy: "tool server (local)", ...(h.kind === "authorize-decision" ? { from: "gateway", to: "gateway", title: "Lab policy (local)", decision: { outcome: "DENY", by: "lab policy (local), not PingOne Authorize" } } : {}) } : h));
    const u = await boot({ mode: "live", live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, realAnswer: () => b });
    await runUc(u, "UC1");
    walk("a tool server run");
    for (const row of screen.getAllByTestId(/^row-\d+$/)) { await u.click(row); walk(`step detail: ${row.getAttribute("data-testid")}`); }
    await u.click(screen.getByTestId("evtab-tokens")); walk("tool server tokens");
  });

  test("every step of a refused Real run: its detail with the RFC column open (the specification text per hop kind)", async () => {
    const u = await boot({ mode: "live", live: "allowed", full: true, signedIn: true, info: { ...INFO, ...FULL_INFO }, realAnswer: (id) => denyBody(id) });
    await runUc(u, "UC1");
    for (const row of screen.getAllByTestId(/^row-\d+$/)) {
      await u.click(row);
      const toggle = screen.getByTestId("rfc-toggle");
      if (toggle.getAttribute("aria-pressed") !== "true") await u.click(toggle);
      walk(`step detail with RFC info: ${row.getAttribute("data-testid")}`);
    }
  });

  test("Compare, Run history, Diagram, Talk track, Presenter mode and an extra page", async () => {
    const u = await boot();
    await runUc(u, "UC7");
    await u.selectOptions(screen.getByTestId("nav-more"), "page-approval"); walk("extra page");
    await u.click(screen.getByTestId("nav-agent"));
    await u.click(screen.getByTestId("open-compare")); await waitFor(() => expect(screen.getAllByTestId("decision-card")).toHaveLength(2)); walk("Compare");
    await u.click(screen.getByTestId("back-to-chat"));
    await u.click(screen.getByTestId("nav-runs")); await screen.findAllByTestId("history-row"); walk("Run history");
    await u.click(screen.getByTestId("nav-diagram")); await screen.findByTestId("simulate"); walk("Diagram");
    await u.click(screen.getByTestId("nav-talk")); await screen.findByTestId("talk-track"); walk("Talk track");
    await u.click(screen.getByTestId("nav-agent"));
    await u.keyboard("p"); await screen.findByTestId("agenda-steps"); walk("Presenter mode");
  });

  test("the hosted copy: the banner and a run", async () => {
    const u = await boot({}, { hosted: true });
    await waitFor(() => expect(screen.getByTestId("banner").getAttribute("data-state")).toBe("hosted"));
    expect(screen.getByTestId("banner").textContent).toBe(BANNER_HOSTED_TEXT);
    await runUc(u, "UC1");
    walk("hosted run");
    expect(fireEvent).toBeTruthy();
  });
});
