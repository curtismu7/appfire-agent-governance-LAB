// Live sequence (owner, 2026-11-28): while a Real run streams in as NDJSON, the evidence column draws each hop the
// moment it lands (the sequence updates in real time), the finished run then replaces the partial one exactly once,
// and the decision card waits for the finished run.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, mockApi, realBody } from "./testFixtures";

const PASSWORD = ["typed", "-by-", "the-", "person-", "9"].join("");
let api;

// A fetch stand-in that delegates everything to mockApi except the streamed run POST: it answers text/x-ndjson,
// delivering the hop lines in separate chunks (with a paint between them) and the done line last.
const streamingApi = (inner, rb) => {
  const fn = (url, opts = {}) => {
    const path = String(url).split("?")[0];
    if (path === "/api/run/UC1") {
      inner.calls.push({ method: "POST", url: String(url), path, query: new URLSearchParams(), headers: opts.headers || {}, body: JSON.parse(opts.body) });
      const body = JSON.parse(opts.body);
      const enc = (o) => new TextEncoder().encode(`${JSON.stringify(o)}\n`);
      const stream = new ReadableStream({
        async start(ctrl) {
          for (const h of rb.run.hops) {
            ctrl.enqueue(enc({ type: "hop", hop: h }));
            await new Promise((r) => setTimeout(r, 5)); // let React paint the hop that just landed
          }
          ctrl.enqueue(enc({ type: "done", ok: true, workspace: "w-test", seq: 1, run: rb.run }));
          ctrl.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/x-ndjson; charset=utf-8" } }));
    }
    return inner(url, opts);
  };
  fn.calls = inner.calls; fn.state = inner.state;
  return fn;
};

const boot = async (rb) => {
  api = mockApi({ mode: "live", live: "allowed", full: true, password: PASSWORD, info: { ...INFO, ...FULL_INFO } });
  vi.stubGlobal("fetch", streamingApi(api, rb));
  render(<App />);
  await screen.findByTestId("uc-UC1");
  const u = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId("mode").getAttribute("data-mode")).toBe("live"));
  return u;
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } });

describe("the sequence updates in real time while a run streams", () => {
  test("hops land one at a time and the finished run replaces them once, with no duplicates", async () => {
    const rb = realBody("UC1");
    const u = await boot(rb);
    await u.click(screen.getByTestId("uc-UC1"));
    await u.click(screen.getByTestId("run"));
    // Mid-flight: the sequence is drawn from the hops that have landed so far (fewer than the finished nine).
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid="sequence-view"] .sq-row');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(rb.run.hops.length);
    }, { timeout: 2000 });
    // The finished run lands: the full sequence, no duplicates, the decision card with the outcome.
    await screen.findByTestId("outcome");
    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe("REAL_PERMIT"));
    await waitFor(() => expect(document.querySelectorAll('[data-testid="sequence-view"] .sq-row').length).toBe(rb.run.hops.length));
    expect(api.calls.filter((c) => c.path === "/api/run/UC1")).toHaveLength(1);
  });

  test("the decision card does not show while the run is still streaming", async () => {
    const rb = realBody("UC1");
    const u = await boot(rb);
    await u.click(screen.getByTestId("uc-UC1"));
    await u.click(screen.getByTestId("run"));
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid="sequence-view"] .sq-row');
      expect(rows.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
    expect(screen.queryByTestId("outcome")).toBeNull();
    await screen.findByTestId("outcome", {}, { timeout: 3000 });
    expect(screen.getByTestId("outcome").textContent).toBe("REAL_PERMIT");
  });
});
