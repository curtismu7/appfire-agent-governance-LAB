// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SetupSidebar from "./components/SetupSidebar";
import UseCasePicker from "./components/UseCasePicker";
import DemoGuide from "./components/DemoGuide";
import { DEMO_CASES } from "./demoCases";
import { DEMO_GUIDE } from "./demoGuide";
import { PRESETS } from "./compare";
import { SET_KEY, activeSet, demoPresetIds, demoUcIds, keepButtons, promptsInSet, savedSet } from "./demoSet";

const cast = { castFareRule: true };
const eight = DEMO_CASES.filter((c) => c.uc).map((c) => c.uc);

describe("today's demo set", () => {
  test("the lab opens on all use cases; only a saved \"demo\" narrows it", () => {
    window.localStorage.removeItem(SET_KEY);
    expect(savedSet()).toBe("all");
    window.localStorage.setItem(SET_KEY, "demo");
    expect(savedSet()).toBe("demo");
    window.localStorage.setItem(SET_KEY, "all");
    expect(savedSet()).toBe("all");
    window.localStorage.setItem(SET_KEY, "anything else");
    expect(savedSet()).toBe("all");
    window.localStorage.removeItem(SET_KEY);
  });

  test("the ids come from the cases, only on the airline pack", () => {
    expect([...demoUcIds(cast)].sort()).toEqual([...eight].sort());
    expect(demoUcIds({})).toBeNull();
    expect(activeSet({}, "demo")).toBeNull(); // another vertical: always everything
    expect(activeSet(cast, "all")).toBeNull();
    expect(activeSet(cast, "demo")).not.toBeNull();
  });

  test("prompts narrow to the eight; with no set nothing is dropped", () => {
    const all = [...eight, "UC1", "UC31"].map((uc) => ({ uc, text: uc }));
    expect(promptsInSet(all, activeSet(cast, "demo")).map((p) => p.uc)).toEqual(eight);
    expect(promptsInSet(all, null)).toBe(all);
  });

  test("every pair a case points at stays, and a pair of two cases stays", () => {
    const keep = demoPresetIds(cast);
    expect(keep.has("careful-poisoned") && keep.has("ask-refuse") && keep.has("same-fare")).toBe(true);
    expect(keep.has("allowed-denied")).toBe(false);
    expect(PRESETS.filter((p) => keep.has(p.id)).every((p) => p.sides.length === 2)).toBe(true);
  });

  test("a walkthrough step keeps the buttons for the eight and the pairs that stay; another vertical keeps all", () => {
    const buttons = DEMO_GUIDE.flatMap((s) => s.ucs);
    const kept = keepButtons(buttons, cast);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(buttons.length);
    expect(kept.filter((b) => b.uc).every((b) => eight.includes(b.uc))).toBe(true);
    expect(keepButtons(buttons, {})).toBe(buttons);
  });

  test("the guide shows fewer Run buttons in the demo set and all of them otherwise", () => {
    const n = (only) => { const { unmount, container } = render(<DemoGuide isOpen onClose={() => {}} cast={cast} prompts={[]} only={only} />); const c = document.querySelectorAll(".guide__run").length; unmount(); return c; };
    expect(n(true)).toBeLessThan(n(false));
  });

  test("the picker narrows to the eight and the sidebar toggle calls back", () => {
    const catalog = { total: 3, tracks: [{ track: "foundations", count: 3, usecases: ["UC7", "UC1", "UC9"].map((id) => ({ id, title: id, needs: [], expectedOutcome: "allowed" })) }] };
    const keep = (u) => demoUcIds(cast).has(u.id);
    render(<UseCasePicker catalog={catalog} selectedId={null} onPick={() => {}} keep={keep} />);
    expect(screen.getByTestId("uc-UC7")).toBeTruthy();
    expect(screen.queryByTestId("uc-UC1")).toBeNull();
    expect(screen.getByTestId("search-count").textContent).toBe("2 of 3 shown");
  });

  test("the toggle reads Today's demo (8) and All use cases (N), is absent without a set, and presses the one chosen", () => {
    const onChoice = vi.fn();
    const base = { onNewChat() {}, several: false, setSeveral() {}, vertical: "airline", verticals: [{ id: "airline", label: "Airline", pack: "full" }], onVertical() {}, sessions: [], onSession() {} };
    const { rerender } = render(<SetupSidebar {...base} demoSet={{ choice: "demo", onChoice, total: 87 }} />);
    expect(screen.getByTestId("set-demo").textContent).toBe("Today's demo (8)");
    expect(screen.getByTestId("set-all").textContent).toBe("All use cases (87)");
    expect(screen.getByTestId("set-demo").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("set-all"));
    expect(onChoice).toHaveBeenCalledWith("all");
    rerender(<SetupSidebar {...base} demoSet={null} />);
    expect(screen.queryByTestId("set-demo")).toBeNull();
  });
});
