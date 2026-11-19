// Every JWT in a value shown as JSON is also shown decoded: Header, Payload, Signature (owner, 2026-11-18: "we need to decode the token, not just display the json ...
// do we need a reusable component so we do not hard code each one"). One wrapper (TokenJson.jsx) around the shared pane, imported through Bits, so a new screen gets it free.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Json } from "./Bits";
import { HttpMessage } from "./HttpMessage";
import TokenView from "./TokenView";
import { decodedTokensIn } from "./TokenJson";

// JWT-shaped strings assembled at run time (the signature segment is filler).
const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwtOf = (header, claims, sig = "c2lnbmF0dXJl") => [b64(header), b64(claims), sig].join(".");
const SUBJECT = jwtOf({ alg: "RS256", kid: "k1" }, { sub: "u-123", aud: ["gw.example"], scope: "openid agent:invoke", may_act: JSON.stringify({ sub: "agent-1" }) });
const ACTOR = jwtOf({ alg: "RS256", kid: "k2" }, { sub: "agent-1", client_id: "agent-1", scope: "agent:invoke" });
const ISSUED = jwtOf({ alg: "RS256", kid: "k1" }, { sub: "u-123", aud: "tools", scope: "trips:read", act: { sub: "agent-1" } });
afterEach(cleanup);

describe("the shared Json pane decodes tokens", () => {
  test("a token in a response body: raw in its field, then Header, Payload and Signature under the pane, named by the field", () => {
    render(<Json label="Step 3 response" value={{ access_token: SUBJECT, token_type: "Bearer", expires_in: 3600, scope: "agent:invoke" }} />);
    const box = screen.getByTestId("decoded-tokens");
    const t = within(box).getByTestId("decoded-token");
    expect(t.textContent).toMatch(/access_token/);
    for (const h of ["Header", "Payload", "Signature"]) expect(within(t).getByText(h)).toBeTruthy();
    expect(t.textContent).toMatch(/RS256/); expect(t.textContent).toMatch(/u-123/); expect(t.textContent).toMatch(/openid/); expect(t.textContent).toMatch(/agent:invoke/); expect(t.textContent).toMatch(/gw\.example/);
    expect(t.textContent).toMatch(/c2lnbmF0dXJl/);
    expect(screen.getAllByText(/Decoded token/).length).toBe(1);
  });

  test("the exchange body decodes the subject and the actor token; a bearer header decodes; a JSON text body is searched too", () => {
    render(<HttpMessage label="Step 3 request" msg={{ method: "POST", url: "https://idp.example/as/token", headers: { authorization: `Bearer ${ISSUED}` }, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: SUBJECT, actor_token: ACTOR } }} />);
    const names = screen.getAllByTestId("decoded-token").map((e) => e.querySelector(".jdec__name")?.textContent);
    expect(names).toEqual(["authorization", "subject_token", "actor_token"]);
    cleanup();
    render(<Json label="text body" value={JSON.stringify({ access_token: ISSUED })} />);
    expect(screen.getByTestId("decoded-token").textContent).toMatch(/access_token/);
  });

  test("decode={false} is for panes that ARE a decoded part: nothing is decoded twice; the Tokens tab shows Header, Payload, Signature too", () => {
    render(<Json label="raw" value={SUBJECT} decode={false} />);
    expect(screen.queryByTestId("decoded-tokens")).toBeNull();
    cleanup();
    render(<TokenView tokens={[{ label: "user token", raw: SUBJECT, header: { alg: "RS256" }, claims: { sub: "u-123" } }]} />);
    const tok = screen.getByTestId("token");
    for (const h of ["Header", "Payload", "Signature"]) expect(within(tok).getByText(h)).toBeTruthy();
    expect(screen.getByTestId("token-claims")).toBeTruthy();
    expect(screen.queryByTestId("decoded-tokens")).toBeNull();
    cleanup();
    render(<TokenView tokens={[{ label: "masked token", raw: "eyJhbG...ab12", header: { alg: "RS256" }, claims: { sub: "u-1" } }]} />);
    expect(screen.getByText(/no signature segment|signature is not shown/)).toBeTruthy();
  });

  test("a cut-short token, a non-token and plain text are skipped; the same token is shown once; the search is bounded", () => {
    const short = `${SUBJECT.slice(0, 60)}...`;
    const found = decodedTokensIn({ headers: { authorization: `Bearer ${SUBJECT}`, other: short }, body: { note: "eyJ not a token", same: SUBJECT, n: 5, list: [ACTOR, "x"] } });
    expect(found.map((t) => t.name)).toEqual(["headers.authorization", "body.list[0]"]);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`t${i}`, jwtOf({ alg: "none" }, { sub: `s${i}` })]));
    expect(decodedTokensIn(many)).toHaveLength(6);
    expect(decodedTokensIn({ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: SUBJECT } } } } } } } } } })).toHaveLength(0);
    render(<Json label="none" value={{ note: "no tokens here", n: 1 }} />);
    expect(screen.queryByTestId("decoded-tokens")).toBeNull();
  });

  test("a token with no signature segment says so; the decoded text is rendered as text, never as markup", () => {
    render(<Json label="unsigned" value={{ access_token: jwtOf({ alg: "none" }, { sub: "<img src=x onerror=alert(1)>" }, "") }} />);
    const t = screen.getByTestId("decoded-token");
    expect(t.textContent).toMatch(/no signature segment/);
    expect(t.querySelector("img, script")).toBeNull();
    expect(t.textContent).toMatch(/<img src=x onerror=alert\(1\)>/);
  });
});
