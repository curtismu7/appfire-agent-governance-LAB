// The detail box under the sequence (owner, 2026-11-18): docked by default, with a Pop out button that floats it as a draggable window (FloatingDialog).
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepDetail from "./StepDetail";
import { UC1_RUN } from "../evidence/fixtures";

function Harness({ start = 4 }) {
  const [sel, setSel] = useState(start);
  return <><button type="button" onClick={() => setSel(5)} data-testid="pick-5">pick 5</button><StepDetail hops={UC1_RUN} selected={sel} onSelect={setSel} onClose={() => setSel(null)} /></>;
}
beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* ignore */ } });

describe("StepDetail: docked, floating, docked again", () => {
  test("docked by default: the detail sits in place with a Pop out button and no window", () => {
    render(<Harness />);
    expect(screen.getByTestId("step-detail")).toBeTruthy();
    expect(screen.getByTestId("sdp-popout").textContent).toBe("Pop out");
    expect(screen.queryByTestId("step-detail-window")).toBeNull();
  });

  test("Pop out floats the same detail in a draggable window (title bar, resize handles, its own pop-out) and leaves a note with Dock it here", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByTestId("sdp-popout"));
    const win = screen.getByTestId("step-detail-window");
    expect(win.getAttribute("role")).toBe("dialog");
    expect(win.getAttribute("aria-modal")).toBeNull(); // a floating panel, the page behind stays usable
    expect(within(win).getByTestId("step-detail")).toBeTruthy(); // the very same panel, now inside the window
    expect(screen.getAllByTestId("step-detail")).toHaveLength(1);
    expect(within(win).getByTestId("fd-titlebar").textContent).toMatch(/^Step 4: /);
    expect(within(win).getByLabelText("Pop out to a new window")).toBeTruthy();
    expect(screen.getByTestId("sdp-floating-note").textContent).toMatch(/own window/);
    expect(within(win).queryByTestId("sdp-popout")).toBeNull();
  });

  test("the title bar follows the step: Next in the floating panel moves the window's title and keeps it floating", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByTestId("sdp-popout"));
    const win = screen.getByTestId("step-detail-window");
    await u.click(within(win).getByLabelText("Next step"));
    expect(within(win).getByTestId("fd-titlebar").textContent).toMatch(/^Step 5: /);
    expect(screen.getByTestId("step-detail-window")).toBe(win);
  });

  test("Dock in the window, Dock it here in the note and closing the window each put it back under the sequence", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    for (const how of ["button", "note", "close"]) {
      await u.click(screen.getByTestId("sdp-popout"));
      const win = screen.getByTestId("step-detail-window");
      if (how === "button") await u.click(within(win).getByTestId("sdp-dock-button"));
      else if (how === "note") await u.click(screen.getByTestId("sdp-dock"));
      else fireEvent.keyDown(within(win).getByTestId("fd-titlebar"), { key: "Escape" });
      expect(screen.queryByTestId("step-detail-window"), how).toBeNull();
      expect(screen.getByTestId("sdp-popout"), how).toBeTruthy();
    }
  });

  test("the choice is remembered: a step picked later opens floating, and the panel's own × clears the selection and the window with it", async () => {
    const u = userEvent.setup();
    const first = render(<Harness />);
    await u.click(screen.getByTestId("sdp-popout"));
    first.unmount();
    render(<Harness start={5} />);
    const win = screen.getByTestId("step-detail-window");
    await u.click(within(win).getByLabelText("Close step detail"));
    expect(screen.queryByTestId("step-detail-window")).toBeNull();
    expect(screen.queryByTestId("step-detail")).toBeNull();
  });
});
