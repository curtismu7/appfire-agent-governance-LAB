import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import HopCaption from "./components/HopCaption";
import { CAPTIONS } from "./captions";

const hops = [
  { n: 1, kind: "website", title: "Website", verdict: "ok", from: "browser", to: "bff" },
  { n: 2, kind: "token-exchange", title: "Exchange", verdict: "ok", from: "bff", to: "idp", source: "real" },
  { n: 3, kind: "tool-refused", title: "Refused", verdict: "deny", from: "authorize", to: "bff" },
  { n: 4, kind: "step-up", title: "Step-up", verdict: "skip", from: "authorize", to: "hitl" },
];
const Harness = ({ start = null }) => { const [sel, setSel] = useState(start); return <HopCaption hops={hops} selected={sel} onSelect={setSel} />; };
afterEach(cleanup);

describe("presenter caption", () => {
  test("with no step selected it offers to start at the first step that ran", async () => {
    render(<Harness />);
    expect(screen.getByTestId("caption-start").textContent).toContain("step 1");
    await userEvent.click(screen.getByTestId("caption-start"));
    expect(screen.getByTestId("caption-say").textContent).toBe(CAPTIONS.website.say);
  });
  test("Next and Previous walk the steps that ran; the ends are disabled", async () => {
    render(<Harness start={1} />);
    expect(screen.getByTestId("caption-prev").disabled).toBe(true);
    await userEvent.click(screen.getByTestId("caption-next"));
    expect(screen.getByTestId("caption-say").textContent).toBe(CAPTIONS["token-exchange"].say);
    await userEvent.click(screen.getByTestId("caption-next"));
    expect(screen.getByTestId("caption-say").textContent).toBe(CAPTIONS["tool-refused"].say);
    expect(screen.getByTestId("caption-next").disabled).toBe(true);
    await userEvent.click(screen.getByTestId("caption-prev"));
    expect(screen.getByTestId("caption-say").textContent).toBe(CAPTIONS["token-exchange"].say);
  });
  test("it names the walkthrough step and says whether the call was real", () => {
    render(<Harness start={2} />);
    expect(screen.getByTestId("caption-agenda").textContent).toBe("Walkthrough 2 · Identity");
    expect(screen.getByText("REAL call")).toBeTruthy();
  });
  test("a step that did not run says so", () => {
    render(<Harness start={4} />);
    expect(screen.getByText("NOT RUN")).toBeTruthy();
    expect(screen.getByTestId("caption-say").textContent).toMatch(/not part of this run/);
  });
  test("it draws nothing for a run with no hops", () => {
    const { container } = render(<HopCaption hops={[]} selected={null} onSelect={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
