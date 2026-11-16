import { describe, expect, test, vi } from "vitest";
import { followNewest } from "./follow";

// jsdom has no layout, so the scrollers are stand-ins with the numbers a browser would report.
const box = (over = {}) => ({ scrollHeight: 1000, clientHeight: 400, offsetTop: 0, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }), ...over });
const turn = (over = {}) => ({ offsetTop: 800, offsetHeight: 180, querySelector: () => null, scrollIntoView: vi.fn(), ...over });

describe("followNewest", () => {
  test("a newest turn that fits is scrolled fully into view: the chat box goes to its end", () => {
    const b = box(); const t = turn();
    followNewest(b, t);
    expect(b.scrollTop).toBe(600); // scrollHeight - clientHeight
  });
  test("a newest turn taller than the box keeps its top in view, so the reply is read from its start", () => {
    const b = box(); const t = turn({ offsetTop: 300, offsetHeight: 700 });
    followNewest(b, t);
    expect(b.scrollTop).toBe(292); // offsetTop - 8
  });
  test("a hand-off card taller than the box stays whole in view", () => {
    const b = box();
    const card = { getBoundingClientRect: () => ({ bottom: 900 }) };
    const t = turn({ offsetTop: 300, offsetHeight: 700, querySelector: (sel) => (sel.includes("handoff-card") ? card : null) });
    followNewest(b, t);
    expect(b.scrollTop).toBe(508); // card bottom (900 + 8) minus the box height (400)
  });
  test("the page follows: the newest turn is brought into the window the least it takes", () => {
    const t = turn();
    followNewest(box(), t);
    expect(t.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
  test("a chat that fits the box does not move it, but the page still follows", () => {
    const b = box({ scrollHeight: 300, clientHeight: 400 }); const t = turn();
    followNewest(b, t);
    expect(b.scrollTop).toBe(0);
    expect(t.scrollIntoView).toHaveBeenCalled();
  });
  test("nothing to follow, nothing happens", () => {
    expect(() => followNewest(null, null)).not.toThrow();
    expect(() => followNewest(box(), null)).not.toThrow();
  });
});
