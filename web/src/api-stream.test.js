// Live sequence (owner 2026-11-28): postJsonStream reads an NDJSON answer line by line, fires onHop per hop as it
// lands, and returns the done line as an ordinary { ok, status, body } result. A JSON answer (a refusal before the
// stream, a mock run) is returned exactly like postJson.
import { describe, expect, test, vi } from "vitest";
import { postJsonStream } from "./api";
import { forgetWorkspace } from "./workspace";

const ndjsonResponse = (lines) => new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""), { status: 200, headers: { "content-type": "text/x-ndjson; charset=utf-8" } });

describe("postJsonStream", () => {
  test("fires onHop per hop and resolves with the done line's payload", async () => {
    forgetWorkspace();
    const run = { kind: "real", outcome: "REAL_PERMIT", hops: [{ n: 1 }, { n: 2 }] };
    const fetchMock = vi.fn(() => Promise.resolve(ndjsonResponse([
      { type: "hop", hop: { n: 1 } },
      { type: "hop", hop: { n: 2 } },
      { type: "done", ok: true, workspace: "w", seq: 1, run },
    ])));
    vi.stubGlobal("fetch", fetchMock);
    const hops = [];
    const res = await postJsonStream("/api/run/UC1", { vertical: "banking" }, {}, (h) => hops.push(h));
    expect(fetchMock).toHaveBeenCalled();
    expect(hops).toEqual([{ n: 1 }, { n: 2 }]);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body.run.outcome).toBe("REAL_PERMIT");
    vi.unstubAllGlobals();
  });

  test("a JSON refusal (application/json) comes back unchanged, onHop never fires", async () => {
    forgetWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "sign_in_required", detail: "Sign in first." }), { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }))));
    const hops = [];
    const res = await postJsonStream("/api/run/UC1", {}, {}, (h) => hops.push(h));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("sign_in_required");
    expect(hops).toEqual([]);
    vi.unstubAllGlobals();
  });

  test("an error line after hops began ends the stream as a refusal with its detail", async () => {
    forgetWorkspace();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(ndjsonResponse([
      { type: "hop", hop: { n: 1 } },
      { type: "error", error: "live_busy", detail: "two calls are already in flight" },
    ]))));
    const hops = [];
    const res = await postJsonStream("/api/run/UC1", {}, {}, (h) => hops.push(h));
    expect(res.ok).toBe(false);
    expect(res.body.error).toBe("live_busy");
    expect(hops).toEqual([{ n: 1 }]);
    vi.unstubAllGlobals();
  });

  test("the request body carries stream:true", async () => {
    forgetWorkspace();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: 400, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    await postJsonStream("/api/run/UC1", { vertical: "banking" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.vertical).toBe("banking");
    vi.unstubAllGlobals();
  });
});
