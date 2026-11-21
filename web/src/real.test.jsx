// Full Real in the page (owner, 2026-11-10): the standard Sign in modal (pi.flow only, no redirect, the username filled in, the password typed),
// NOT RUN per skipped hop (no REAL, MOCK or LIVE label anywhere: owner 2026-11-16), and the replies the real servers' answers map to.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import RunPanel from "./components/RunPanel";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, denyBody, mockApi, mockInRealBody, noActBody, realBody } from "./testFixtures";

const PASSWORD = ["typed", "-by-", "the-", "person-", "7"].join("");
let api;
const boot = async (state = {}) => {
  api = mockApi({ mode: "live", live: "allowed", full: true, password: PASSWORD, info: { ...INFO, ...FULL_INFO }, ...state });
  vi.stubGlobal("fetch", api);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  const u = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe("live")); // the server opens the workspace in Real when it is configured
  return u;
};
const runIt = async (u) => { await u.click(screen.getByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } });

describe("the Sign in modal (pi.flow only)", () => {
  test("Real shows Sign in; the modal is the standard dialog with the username filled in and read-only and a password field; it posts the password to the lab server only", async () => {
    const u = await boot();
    const href = window.location.href;
    await u.click(screen.getByTestId("sign-in"));
    const dlg = await screen.findByTestId("signin-dialog");
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(within(dlg).getByTestId("fd-titlebar").textContent).toMatch(/Sign in/);
    const user = within(dlg).getByTestId("signin-username");
    expect(user.value).toBe("lab-demo-user"); expect(user.readOnly).toBe(true);
    const pw = within(dlg).getByTestId("signin-password");
    expect(pw.getAttribute("type")).toBe("password");
    expect(within(dlg).getByTestId("signin-method").textContent).toMatch(/pi\.flow.*No redirect/);
    expect(within(dlg).queryByRole("link")).toBeNull();
    await u.type(pw, PASSWORD);
    await u.click(within(dlg).getByTestId("signin-submit"));
    await waitFor(() => expect(screen.queryByTestId("signin-dialog")).toBeNull());
    expect(screen.getByTestId("who").textContent).toMatch(/lab-demo-user/);
    const posts = api.calls.filter((c) => c.path === "/api/signin" && c.method === "POST");
    expect(posts).toHaveLength(1); expect(posts[0].body).toEqual({ password: PASSWORD });
    expect(api.calls.every((c) => c.url.startsWith("/api/")), "every call goes to this lab's own server: no redirect, no other origin").toBe(true);
    expect(window.location.href).toBe(href);
    expect(document.body.innerHTML.includes(PASSWORD)).toBe(false);
  });

  test("a wrong password shows PingOne's refusal in the dialog and clears the field; the password is never shown back", async () => {
    const u = await boot();
    await u.click(screen.getByTestId("sign-in"));
    const pw = await screen.findByTestId("signin-password");
    await u.type(pw, "wrong-one-123");
    await u.click(screen.getByTestId("signin-submit"));
    const err = await screen.findByTestId("signin-error");
    expect(err.textContent).toMatch(/did not accept the username or password.*HTTP 401/);
    expect(screen.getByTestId("signin-password").value).toBe("");
    expect(document.body.innerHTML.includes("wrong-one-123")).toBe(false);
  });

  test("a Real run before sign-in opens the dialog, and the run goes again once signed in; Sign out works", async () => {
    const u = await boot();
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    await screen.findByTestId("signin-dialog");
    await u.type(screen.getByTestId("signin-password"), PASSWORD);
    await u.click(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe("REAL_PERMIT"));
    expect(api.calls.filter((c) => c.path === "/api/run/UC1")).toHaveLength(2);
    await u.click(screen.getByTestId("sign-out"));
    await screen.findByTestId("sign-in");
  });
});

describe("labels (NOT RUN only) and the replies", () => {
  test("a Real run: nine hops, no REAL chip or hop-source list anywhere; tokens raw; the reply is the tool result in the Agent's voice", async () => {
    const u = await boot({ signedIn: true });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    // One hop view (owner 2026-11-14): the Sequence draws the nine hops, and the identity provider is PingOne, not "Mock IdP", in a real run.
    expect(screen.getAllByTestId(/^row-\d+$/)).toHaveLength(9);
    expect(screen.getByTestId("sequence-view").textContent).toContain("PingOne");
    expect(screen.getByTestId("sequence-view").textContent).not.toContain("Mock IdP");
    expect(screen.queryByTestId("hop-sources")).toBeNull(); // "Where each hop ran" is gone; the data (hop.source) still says it
    expect(screen.queryByTestId("real-tag")).toBeNull();
    expect(screen.queryByTestId("real-note-tag")).toBeNull();
    expect(screen.getAllByTestId(/^row-\d+$/).map((r) => r.textContent).join(" ")).not.toMatch(/REAL|MOCK|LIVE/);
    // The Tokens tab: the user, the agent (actor), exchange 1 and the delegated token, raw, in that order; the two exchange tokens show their act.
    await u.click(screen.getByTestId("evtab-tokens"));
    expect(screen.getAllByTestId("token-raw").map((x) => x.textContent)).toEqual(realBody().run.tokens.map((t) => t.raw));
    const tokens = screen.getAllByTestId("token");
    expect(tokens).toHaveLength(4);
    tokens.forEach((t, k) => expect(within(t).getByRole("heading").textContent.startsWith(realBody().run.tokens[k].label)).toBe(true));
    expect(screen.getAllByTestId("token-act").map((x) => x.textContent)).toEqual(["act.sub = agent-1", "act.sub = agent-1"]);
    expect(within(tokens[2]).getByTestId("token-act")).toBeTruthy(); expect(within(tokens[3]).getByTestId("token-act")).toBeTruthy();
    expect(within(tokens[0]).queryByTestId("token-act")).toBeNull(); expect(within(tokens[1]).queryByTestId("token-act")).toBeNull();
    expect(screen.queryByTestId("token-no-act")).toBeNull();
    expect(screen.getAllByTestId("token-act").map((x) => x.getAttribute("data-state"))).toEqual(["ok", "ok"]);
    expect(within(tokens[3]).getAllByTestId("token-claims")[0].textContent).toMatch(/act\.sub\s*agent-1/); // Formatted: the hybrid pane shows the nested act as one flat dot-path row
    await u.click(within(tokens[3]).getByTestId("token-claims-raw"));
    expect(within(tokens[3]).getAllByTestId("token-claims")[0].textContent).toMatch(/"act": \{\s*"sub": "agent-1"/); // Raw: the exact JSON
    const turn = screen.getAllByTestId("turn").pop();
    expect(within(turn).getByTestId("turn-who").textContent).toBe("Agent");
    expect(within(turn).getByTestId("turn-answer-text").textContent).toMatch(/balance 1200\.5/);
    expect(screen.getByTestId("evidence-count").textContent).toMatch(/^t · 9 hops$/);
  });

  test("a 403 from the gateway is an Authorize DENY reply; the hops after it say NOT RUN", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => denyBody(id) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const turn = screen.getAllByTestId("turn").pop();
    expect(within(turn).getByTestId("turn-who").textContent).toBe("Authorize");
    expect(within(turn).getByTestId("turn-answer-text").textContent).toMatch(/^Authorize denied this request \(HTTP 403/);
    expect(within(turn).getByTestId("turn-outcome").textContent).toBe("REAL_DENY");
    expect(screen.getByTestId("evidence-count").textContent).toBe("t · 6 hops · +3 not in this run");
  });

  test("a delegated token with no act claim stops before the gateway: the reply says so, the exchange-2 token is flagged NO act claim, the gateway hops say NOT RUN", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => noActBody(id) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const turn = screen.getAllByTestId("turn").pop();
    expect(within(turn).getByTestId("turn-who").textContent).toBe("PingOne");
    expect(within(turn).getByTestId("turn-answer-text").textContent).toMatch(/the delegated token carries no act claim: check the agent:invoke resource's act attribute/);
    expect(within(turn).getByTestId("turn-outcome").textContent).toBe("REAL_NO_ACT");
    expect(screen.getByTestId("evidence-count").textContent).toBe("t · 4 hops · +5 not in this run");
    expect(screen.getAllByTestId(/^row-\d+$/)[3].textContent).toMatch(/Exchange 2: for the gateway/);
    await u.click(screen.getByTestId("evtab-tokens"));
    expect(screen.getAllByTestId("token-act")).toHaveLength(1); // exchange 1 has act
    expect(within(screen.getAllByTestId("token")[3]).getByTestId("token-no-act").textContent).toBe("NO act claim");
    expect(screen.getByTestId("token-no-act").getAttribute("data-state")).toBe("bad");
  });

  test("an act that names nobody (an empty object, a blank or non-text sub) is shown as NO act claim, the same rule as the server's", async () => {
    for (const act of [{}, { sub: "" }, { sub: 5 }, [], "x"]) {
      const u = await boot({ signedIn: true, realAnswer: (id) => { const b = noActBody(id); b.run.tokens[3] = { ...b.run.tokens[3], claims: { sub: "u-1", act } }; return b; } });
      await u.click(screen.getByTestId("uc-UC1"));
      await runIt(u);
      await u.click(screen.getByTestId("evtab-tokens"));
      expect(within(screen.getAllByTestId("token")[3]).getByTestId("token-no-act").textContent, JSON.stringify(act)).toBe("NO act claim");
      expect(screen.getAllByTestId("token-act")).toHaveLength(1);
      cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }
    }
  });

  test("a held call (428) is an approval card with the server's words", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => realBody(id, { stopAt: 6, outcome: "REAL_HOLD", reply: { who: "Authorize", approval: { head: "Held for approval", body: "The gateway holds this call. Approve or deny it on the phone." } } }) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    const card = screen.getByTestId("turn-approval");
    expect(card.textContent).toMatch(/REAL_HOLD.*Held for approval.*Approve or deny it on the phone/);
    expect(card.textContent).not.toMatch(/simulated|\(REAL\)/);
  });

  test("a use case the gateway cannot serve runs whole on the lab and is shown like any other run: no MOCK chip, no cannot-run-Real notice, the data still says mock", async () => {
    const u = await boot({ signedIn: true, realAnswer: (id) => mockInRealBody(id) });
    await u.click(screen.getByTestId("uc-UC1"));
    await runIt(u);
    expect(screen.queryByTestId("hop-sources")).toBeNull(); expect(screen.queryByTestId("hop-sources-why")).toBeNull();
    expect(screen.queryByTestId("mock-in-real")).toBeNull(); expect(screen.queryByTestId("turn-mock-in-real")).toBeNull();
    expect(screen.queryByTestId("mock-tag")).toBeNull(); expect(screen.queryByTestId("real-tag")).toBeNull();
    expect(screen.getByTestId("result").textContent).not.toMatch(/mock|cannot run Real|MOCK/i);
    expect(screen.getByTestId("evidence-why").textContent).not.toMatch(/mock|Real/i);
    expect(screen.getByTestId("outcome").textContent).toBe("PERMIT");
    // the run's own data is unchanged: hops are marked mock in the JSON, which is where an operator reads it
    const body = mockInRealBody("UC1").run;
    expect(body.hops.every((h) => h.source === "mock")).toBe(true);
    expect(body.realGate.real).toBe(false);
  });
});

describe("the demo guide", () => {
  test("has no 'what runs Real, what runs Mock' section in a Real-opened lab", async () => {
    const u = await boot({ signedIn: true });
    await u.click(screen.getByTestId("help-link"));
    const guide = await screen.findByTestId("demo-guide");
    expect(within(guide).queryByTestId("guide-real-help")).toBeNull();
    expect(guide.textContent).not.toMatch(/Runs Mock|Runs Real|mock engine|every hop says MOCK/);
  });
});

describe("the persona and the lab's inputs follow the run that will be made, not the workspace's opening mode", () => {
  const props = (uc, over = {}) => ({ uc, vertical: "banking", verticals: [{ id: "banking", label: "Appfire Platform", pack: "full" }], persona: "standard", setPersona: () => {}, personas: ["standard", "premium"], onRun: () => {}, running: false, result: null, ...over });
  const base = { id: "UC12", title: "t", track: "foundations", buyerStory: "s", pingOneSolution: "p", productRoles: {}, trigger: { type: "chip", text: "x" }, expectedOutcome: "PERMIT", needs: [], labInputs: { amount: 600 }, live: { status: "idp-only", message: "m" } };
  test("a use case the gateway serves, in a full Real lab, runs as the signed-in person: no persona, no inputs, the note says so", () => {
    render(<RunPanel {...props({ ...base, realGate: { real: true } }, { mode: "live", realLevel: "full" })} />);
    expect(screen.getByTestId("live-persona-note").textContent).toBe("This run uses the person who signed in; the persona is not used.");
    expect(screen.queryByTestId("persona")).toBeNull(); expect(screen.queryByTestId("lab-inputs")).toBeNull();
  });
  test("a use case the gateway cannot serve, in a full Real lab, runs on the lab's own steps: the persona and the inputs stay, and there is no note", () => {
    render(<RunPanel {...props({ ...base, realGate: { real: false, reason: "r" } }, { mode: "live", realLevel: "full" })} />);
    expect(screen.queryByTestId("live-persona-note")).toBeNull();
    expect(screen.getByTestId("persona")).toBeTruthy(); expect(screen.getByTestId("lab-inputs")).toBeTruthy();
  });
  test("the identity-provider-only path says it reaches the identity provider only", () => {
    render(<RunPanel {...props({ ...base, realGate: { real: false, reason: "r" } }, { mode: "live", realLevel: "idp-only" })} />);
    expect(screen.getByTestId("live-persona-note").textContent).toBe("This run reaches the identity provider only; the persona is not used.");
    expect(screen.queryByTestId("persona")).toBeNull();
  });
});

describe("the sidebar's gateway line", () => {
  test("is not drawn while the page is on Real: a placeholder host would read as the gateway a run calls", async () => {
    await boot();
    expect(screen.queryByTestId("gateway-status")).toBeNull();
  });
});

describe("edited Agent instructions", () => {
  test("are sent with a run whatever the workspace's opening mode; the server decides which runs obey them", async () => {
    const u = await boot({ signedIn: true });
    await u.click(screen.getByTestId("uc-UC1"));
    await u.click((await screen.findByTestId("instructions")).querySelector("summary"));
    await u.click(screen.getByTestId("instructions-preset-poisoned"));
    await runIt(u);
    const posts = api.calls.filter((c) => c.path === "/api/run/UC1" && c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(typeof posts[0].body.instructions).toBe("string");
    expect(screen.getByTestId("instructions-note").textContent).toMatch(/not on a run made as the signed-in person/);
  });
});
