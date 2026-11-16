import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepDetailPanel from "./evidence/StepDetailPanel";

const b64u = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const CLAIMS = { sub: "alex.morgan", aud: "https://mcp.example", scope: "accounts:read", client_id: "triage-agent", act: { sub: "triage-agent" }, iat: 1000, exp: 1300 };
const TOKEN = `${b64u({ alg: "ES256" })}.${b64u(CLAIMS)}.MOCK-SIGNATURE-NOT-A-REAL-KEY`;
const req = (n, body) => ({ method: "POST", url: "https://gateway.example/mcp", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", traceparent: `00-aa-${n}-01` }, body });
const hop = (over = {}) => ({
  n: 5, kind: "gateway-check", from: "agent", to: "gateway", title: "Gateway", verdict: "pass",
  request: { calls: [req(1, { method: "initialize" }), req(2, { method: "tools/list" }), req(3, { method: "tools/call", name: "get_account_balance", arguments: { account_id: "abcd..." } })] },
  response: { calls: [{ status: 200, body: { serverInfo: { name: "gateway", version: "1.4.0" } } }, { status: 200, body: { tools: 1, names: ["get_account_balance"] } }, { status: 200, body: { isError: false, content: { balance: 4250 } } }] },
  ...over,
});
const panel = (h) => render(<StepDetailPanel hops={[h]} selected={h.n} onSelect={() => {}} onClose={() => {}} />);

afterEach(cleanup);

describe("the calls of a gateway step as cards", () => {
  test("one card per call; the last opens by itself; the token is collapsed", () => {
    panel(hop());
    expect(screen.getByRole("heading", { name: "Calls (3)" })).toBeTruthy();
    expect(screen.getAllByTestId(/^xch-/)).toHaveLength(3);
    expect(screen.getByTestId("xch-3").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("xch-1").getAttribute("data-open")).toBe("false");
    const chip = within(screen.getByTestId("xch-3")).getByRole("button", { name: /Bearer eyJ/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("xch-3").querySelector(".xch__claims")).toBeNull();
    expect(within(screen.getByTestId("xch-3")).getByText("JWT · alex.morgan via triage-agent · 5 min")).toBeTruthy();
  });
  test("a click on the token chip shows what it says and the whole token", async () => {
    panel(hop());
    await userEvent.click(within(screen.getByTestId("xch-3")).getByRole("button", { name: /Bearer eyJ/ }));
    const claims = within(screen.getByTestId("xch-3").querySelector(".xch__claims"));
    expect(claims.getByText("triage-agent", { selector: ".xch__claim:nth-child(2) span:last-child" })).toBeTruthy();
    expect(claims.getByText("5 minutes")).toBeTruthy();
    expect(claims.getByText(TOKEN)).toBeTruthy();
  });
  test("a card opens and closes on a click; Open all and Close all work", async () => {
    panel(hop());
    await userEvent.click(within(screen.getByTestId("xch-1")).getAllByRole("button")[0]);
    expect(screen.getByTestId("xch-1").getAttribute("data-open")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Close all" }));
    expect(screen.getAllByTestId(/^xch-/).every((c) => c.getAttribute("data-open") === "false")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(screen.getAllByTestId(/^xch-/).every((c) => c.getAttribute("data-open") === "true")).toBe(true);
  });
  test("a repeated header is stated once and an empty argument list has no row", async () => {
    panel(hop());
    await userEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(screen.getByText("1 more header, same as call 1", { exact: false })).toBeTruthy();
    const first = within(screen.getByTestId("xch-1"));
    expect(first.queryByText("Arguments")).toBeNull();
    expect(within(screen.getByTestId("xch-3")).getByText("account_id = abcd...")).toBeTruthy();
  });
  test("a refused call opens by itself and shows its status", () => {
    const h = hop(); h.response.calls[2] = { status: 403, body: { error: { code: -32001, message: "policy denied" } } };
    panel(h);
    expect(screen.getByTestId("xch-3").getAttribute("data-open")).toBe("true");
    expect(within(screen.getByTestId("xch-3")).getAllByText("403").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("xch-3")).getAllByText("error -32001: policy denied").length).toBeGreaterThan(0);
  });
  test("a step with one request and one response still uses the request and response panes", () => {
    panel(hop({ request: { method: "POST", url: "https://idp.example/token", body: { grant_type: "x" } }, response: { status: 200, body: { ok: true } } }));
    expect(screen.queryByTestId("xch-1")).toBeNull();
    expect(screen.getByRole("heading", { name: "Request" })).toBeTruthy();
  });
});
