import { describe, expect, test } from "vitest";
import { exchangesOf, openByDefault, pairedCalls, resultOf, tokenSummary } from "./exchanges";

const b64u = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const CLAIMS = { sub: "alex.morgan", aud: "https://mcp.example", scope: "accounts:read", client_id: "triage-agent", act: { sub: "triage-agent" }, iat: 1000, exp: 1300 };
const TOKEN = `${b64u({ alg: "ES256" })}.${b64u(CLAIMS)}.MOCK-SIGNATURE-NOT-A-REAL-KEY`;
const hdr = (n) => ({ authorization: `Bearer ${TOKEN}`, "content-type": "application/json", traceparent: `00-aa-${n}-01` });
const req = (n, body) => ({ method: "POST", url: "https://gateway.example/mcp", headers: hdr(n), body });
const calls = () => ({
  request: [req(1, { method: "initialize" }), req(2, { method: "tools/list" }), req(3, { method: "tools/call", name: "get_my_accounts", arguments: {} }), req(4, { method: "tools/call", name: "get_account_balance", arguments: { account_id: "abcd..." } })],
  response: [
    { status: 200, body: { serverInfo: { name: "gateway", version: "1.4.0" }, protocolVersion: "2025-11-25" } },
    { status: 200, body: { tools: 2, names: ["get_my_accounts", "get_account_balance"] } },
    { status: 200, body: { isError: false, content: { accounts: [{ id: "a" }, { id: "b" }] } } },
    { status: 403, body: { error: { code: -32001, message: "policy denied" } } },
  ],
});

describe("pairedCalls", () => {
  test("needs two non-empty lists", () => {
    expect(pairedCalls({ request: { calls: [1] }, response: { calls: [1] } })).not.toBeNull();
    for (const hop of [null, {}, { request: {}, response: {} }, { request: { calls: [] }, response: { calls: [] } }, { request: { calls: [1] }, response: { calls: "x" } }, { request: { method: "POST" }, response: { status: 200 } }]) expect(pairedCalls(hop)).toBeNull();
  });
});

describe("resultOf", () => {
  test("says what came back for each recorded shape", () => {
    expect(resultOf(null).text).toBe("no body");
    expect(resultOf({ serverInfo: { name: "gateway", version: "1.4.0" }, protocolVersion: "2025" }).text).toBe("gateway 1.4.0 · protocol 2025");
    expect(resultOf({ tools: 2, names: ["a", "b"] })).toEqual({ text: "2 tools offered", items: ["a", "b"] });
    expect(resultOf({ error: { code: 7, message: "nope" } }).text).toBe("error 7: nope");
    expect(resultOf({ isError: true, content: [] }).text).toBe("the tool returned an error");
    expect(resultOf({ content: { accounts: [1, 2] } }).text).toBe("2 accounts");
    expect(resultOf({ content: [1] }).text).toBe("1 item");
    expect(resultOf({ content: { balance: 4250, currency: "USD" } })).toEqual({ text: "balance = 4250, currency = USD", items: [] });
  });
  test("never throws on a hostile shape", () => {
    for (const v of [undefined, 5, "x", [], [1], { error: "str" }, { tools: "many" }, { content: null }, { serverInfo: 3 }, { a: { b: 1 } }]) expect(() => resultOf(v)).not.toThrow();
  });
});

describe("tokenSummary", () => {
  test("who it names, who acts, how long it lives", () => {
    expect(tokenSummary(CLAIMS)).toBe("JWT · alex.morgan via triage-agent · 5 min");
    expect(tokenSummary(null)).toBe("token");
    expect(tokenSummary({})).toBe("JWT");
  });
});

describe("exchangesOf", () => {
  const ex = exchangesOf(calls());
  test("one summary per call, in order, with the path, rpc and tool", () => {
    expect(ex.map((e) => e.n)).toEqual([1, 2, 3, 4]);
    expect(ex.map((e) => e.path)).toEqual(["/mcp", "/mcp", "/mcp", "/mcp"]);
    expect(ex.map((e) => e.rpc)).toEqual(["initialize", "tools/list", "tools/call", "tools/call"]);
    expect(ex[3].tool).toBe("get_account_balance");
    expect(ex.map((e) => e.status)).toEqual([200, 200, 200, 403]);
  });
  test("an empty argument list is no row; real arguments are kept", () => {
    expect(ex[2].args).toBeNull();
    expect(ex[3].args).toEqual({ account_id: "abcd..." });
  });
  test("the token is decoded once and noted as the same as the call before", () => {
    expect(ex[0].token.claims.sub).toBe("alex.morgan");
    expect(ex[0].token.raw).toBe(TOKEN);
    expect(ex[0].sameTokenAs).toBeNull();
    expect(ex[1].sameTokenAs).toBe(1);
  });
  test("headers: all on call 1, only the changed ones after, the rest counted as the same", () => {
    expect(ex[0].changedHeaders.map(([k]) => k)).toEqual(["content-type", "traceparent"]);
    expect(ex[0].sameHeaders).toEqual([]);
    expect(ex[1].changedHeaders.map(([k]) => k)).toEqual(["traceparent"]);
    expect(ex[1].sameHeaders.map(([k]) => k)).toEqual(["content-type"]);
    expect(ex[1].sameHeadersAs).toBe(1);
  });
  test("a request with no authorization header has no token", () => {
    const one = exchangesOf({ request: [{ method: "POST", url: "https://g.example/mcp", headers: { "content-type": "x" }, body: { method: "initialize" } }], response: [{ status: 200, body: null }] });
    expect(one[0].token).toBeNull();
  });
  test("a missing answer is status null and 'no body', not an error", () => {
    const r = exchangesOf({ request: calls().request.slice(0, 2), response: [] });
    expect(r.map((e) => e.status)).toEqual([null, null]);
    expect(r[0].result).toBe("no body");
  });
  test("hostile entries do not throw", () => {
    expect(() => exchangesOf({ request: [null, 5, "x", { headers: { authorization: 5, a: { b: 1 } }, body: [] }], response: [undefined, null, 3] })).not.toThrow();
  });
});

describe("openByDefault", () => {
  test("opens the calls that did not answer 2xx, else the last", () => {
    expect([...openByDefault(exchangesOf(calls()))]).toEqual([4]);
    const ok = calls(); ok.response[3] = { status: 200, body: null };
    expect([...openByDefault(exchangesOf(ok))]).toEqual([4]);
    const bad = calls(); bad.response[1] = { status: 500, body: null };
    expect([...openByDefault(exchangesOf(bad))]).toEqual([2, 4]);
  });
});
