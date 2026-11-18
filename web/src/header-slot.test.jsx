// The header reserves the top line for the vendored TopMenu's centred "Sign in / Signed in" slot only when that slot shows (Real with full settings): by a class the
// App adds, not by a :has() rule (the build's CSS target drops it, and the slot then covered the Talk track tab at 1280 px: owner e2e finding, 2026-11-18).
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import App from "./App";
import { forgetWorkspace } from "./workspace";
import { FULL_INFO, INFO, mockApi } from "./testFixtures";

const boot = async (state) => {
  vi.stubGlobal("fetch", mockApi(state));
  render(<App />);
  await screen.findByTestId("uc-UC1");
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); forgetWorkspace(); try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ } });

describe("the header's sign-in line", () => {
  test("with the full Real settings the header carries shell-bar--signin and the Sign in slot shows", async () => {
    await boot({ mode: "live", live: "allowed", full: true, password: "x", info: { ...INFO, ...FULL_INFO } });
    await waitFor(() => expect(document.querySelector("header.shell-bar").classList.contains("shell-bar--signin")).toBe(true));
    expect(document.querySelector(".top-menu__signin-slot")).not.toBeNull();
  });
  test("without Real there is no slot and no class", async () => {
    await boot({});
    expect(document.querySelector("header.shell-bar").classList.contains("shell-bar--signin")).toBe(false);
    expect(document.querySelector(".top-menu__signin-slot")).toBeNull();
  });
  test("the stylesheet reserves the line with that class, and no rule in the app's own CSS depends on :has()", () => {
    const dir = path.resolve(__dirname);
    const layout = fs.readFileSync(path.join(dir, "layout.css"), "utf8");
    expect(layout).toMatch(/\.shell-bar--signin\s*\{\s*padding-top:\s*46px;\s*\}/);
    for (const f of ["layout.css", "app.css"]) expect(fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/:has\(/);
  });
});
