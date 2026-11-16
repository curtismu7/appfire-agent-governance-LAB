import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { mockApi } from "./testFixtures";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has only { shelfUrl }, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const boot = async (shelf) => {
  const api = mockApi();
  vi.stubGlobal("fetch", (url, opts) => (String(url) === "/api/shelf" ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(shelf) }) : api(url, opts)));
  render(<App />);
  await screen.findByRole("tablist");
  return within(await screen.findByTestId("top-menu"));
};

beforeEach(() => { window.location.hash = ""; window.sessionStorage.clear(); window.localStorage.clear(); forgetWorkspace(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("verification mark in the header", () => {
  test("shows this lab's own mark in the top menu, and no other lab's", async () => {
    const bar = await boot({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "appfire-agent-governance-lab", verification: mark("verified", "Verified", { note: "Every use case run on the mock" }) }] });
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every use case run on the mock"));
  });

  test("shows nothing when the lab is opened on its own port (its /api/shelf has no demos), the shelf has no mark for it, or the mark is none", async () => {
    for (const shelf of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "appfire-agent-governance-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "appfire-agent-governance-lab", verification: mark("none", "") }] }]) {
      const bar = await boot(shelf);
      await new Promise((r) => setTimeout(r, 20)); // let the /api/shelf answer land
      expect(screen.getByTestId("top-menu")).toBeInTheDocument();
      expect(document.querySelector(".verify")).toBeNull();
      cleanup(); vi.unstubAllGlobals();
    }
  });

  test("sends the workspace header on its shelf call, as the Shelf link does (two calls: the link's and the badge's)", async () => {
    const seen = [];
    const api = mockApi();
    vi.stubGlobal("fetch", (url, opts) => { if (String(url) === "/api/shelf") { seen.push(opts?.headers || {}); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ shelfUrl: null }) }); } return api(url, opts); });
    render(<App />);
    await screen.findByRole("tablist");
    await vi.waitFor(() => expect(seen.length).toBe(2));
    for (const h of seen) expect(h["x-workspace"]).toMatch(/^w-[0-9a-f]{16}$/);
  });
});
