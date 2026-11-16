// "What Privilege did" (rule 25) on the Run page: the shared GatewayTrace panel sits under the Run result, draws the run's own traces, and is not there
// while there is no result (or when the run never reached a gateway). The vendored panel has its own tests (gateway-trace/gateway-trace.test.jsx).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, mockApi, realBody, runBody } from "./testFixtures";

const decision = (id, label, outcome, basis, evidence) => ({ id, label, outcome, basis, evidence });
const mockTrace = (over = {}) => ({
  source: "mock",
  request: { method: "POST", url: "https://gateway.appfire-platform.invalid/mcp", headers: { authorization: "Bearer eyJhbGciOiJFUzI1NiIs… (498 characters, shortened)", "content-type": "application/json" }, body: { jsonrpc: "2.0", method: "tools/call", params: { name: "get_account_balance" } } },
  response: { status: 200, headers: { "content-type": "application/json" }, body: { forwarded: true, checks: [{ check: "signature", ok: true }] } },
  decisions: [decision("signature", "Signature", "pass", "checked", "the token signature verifies"), decision("scope", "Scope", "pass", "checked", "the token carries accounts:read")],
  record: null, ...over,
});
const realTrace = () => ({
  source: "real",
  request: { method: "POST", url: "http://127.0.0.1:1/mcp", headers: { authorization: "Bearer <token, 812 characters, kept on the server>" }, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_account_balance" } } },
  response: { status: 403, headers: { "x-gw-audit-trail": "[]" }, body: { error: "forbidden" } },
  decisions: [decision("authenticated", "Agent key", "pass", "inferred", "the gateway recognised the agent key. HTTP 403 is answered after the caller is known."), decision("grant", "Grant", "fail", "inferred", "the caller's grant does not allow this app or tool"), decision("audit", "Authorize decision", "fail", "observed", "the gateway's X-Gw-Audit-Trail header states the decision DENY")],
  record: "Look for \"policy denied\": the caller was accepted, the grant did not allow the call.",
});

let api;
const answer = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const boot = async (state) => {
  api = mockApi(state);
  vi.stubGlobal("fetch", api);
  render(<App />);
  await screen.findByTestId("uc-UC1");
  await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe(state?.mode || "mock"));
  return userEvent.setup();
};
const runIt = async (u) => { await u.click(screen.getByTestId("uc-UC1")); await u.click(await screen.findByTestId("run")); await screen.findByTestId(/^(result|refusal)$/); };

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("What Privilege did on the Run page", () => {
  test("nothing is drawn before a run; Run shows the panel under the Run result, with the one neutral basis sentence and the decisions as `checked`", async () => {
    const run = runBody("UC1").run;
    const u = await boot({ runAnswer: answer({ ok: true, run: { ...run, gatewayTrace: [{ step: 4, title: "Gateway check: tools/call get_account_balance", status: 200, trace: mockTrace() }] } }) });
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    await runIt(u);
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByRole("heading", { name: "What Privilege did" })).toBeTruthy();
    expect(screen.getByTestId("gateway-trace-basis").textContent).toBe("The gateway's checks, in the order they ran.");
    const ex = within(panel).getByTestId("trace-4");
    expect(ex.textContent).toMatch(/Gateway check: tools\/call get_account_balance/);
    expect(within(panel).getByTestId("trace-4-decisions").textContent).toMatch(/Signature.*Scope/);
    expect(within(panel).queryByText("inferred from the outcome")).toBeNull();
    // under the Run result, in the same panel
    const result = screen.getByTestId("result");
    expect(result.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("run-panel").contains(panel)).toBe(true);
  });

  test("a run that never reached a gateway draws no panel (it would only say `Press Run`)", async () => {
    const u = await boot({ runAnswer: answer({ ok: true, run: { ...runBody("UC1").run, gatewayTrace: [] } }) });
    await runIt(u);
    expect(screen.getByTestId("result")).toBeTruthy();
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    expect(screen.queryByTestId("gateway-trace-empty")).toBeNull();
  });

  test("an older reply with no gatewayTrace field still renders its result", async () => {
    const u = await boot({});
    await runIt(u);
    expect(screen.getByTestId("result")).toBeTruthy();
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
  });

  test("a Real-source trace: the same basis sentence, inferred decisions marked inferred and observed ones observed", async () => {
    const run = realBody("UC1", { stopAt: 5, outcome: "REAL_DENY" }).run;
    const u = await boot({ mode: "live", live: "allowed", full: true, signedIn: true, password: "x-typed-7", info: { ...INFO, ...FULL_INFO }, realAnswer: () => ({ ok: true, run: { ...run, gatewayTrace: [{ step: 3, title: "tools/call get_account_balance", status: 403, trace: realTrace() }] } }) });
    await runIt(u);
    const panel = await screen.findByTestId("gateway-trace");
    expect(screen.getByTestId("gateway-trace-basis").textContent).toBe("The gateway's checks, in the order they ran.");
    const list = within(panel).getByTestId("trace-3-decisions");
    expect(list.textContent).toMatch(/inferred from the outcome/);
    expect(list.textContent).toMatch(/observed in the response/);
    expect(panel.textContent).not.toMatch(/Bearer eyJ/);
  });
});
