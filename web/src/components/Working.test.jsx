import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import Working, { Spin } from "./Working";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Working", () => {
  test("a turning ring, the words, and a seconds counter that keeps counting", () => {
    vi.useFakeTimers();
    render(<Working label="Running the use case" testId="w" />);
    const w = screen.getByTestId("w");
    expect(w.getAttribute("role")).toBe("status");
    expect(w.querySelector(".spin")).not.toBeNull();
    expect(w.textContent).toContain("Running the use case…");
    expect(w.querySelector(".working__s").textContent).toBe("0 s");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(w.querySelector(".working__s").textContent).toBe("3 s");
  });
  test("the counter is hidden from a screen reader (the words stay still) and the ring is decoration", () => {
    render(<Working />);
    expect(screen.getByText(/Working on it…/)).toBeTruthy();
    expect(document.querySelector(".working__s").getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector(".spin").getAttribute("aria-hidden")).toBe("true");
  });
  test("the timer stops when it is removed", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Working />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  test("a small ring for the status pill", () => {
    const { container } = render(<Spin small />);
    expect(container.querySelector(".spin.spin--sm")).not.toBeNull();
  });
});
