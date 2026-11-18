// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TalkTrack from "./components/TalkTrack";
import { DEMO_CASES, casesFor } from "./demoCases";
import { DEMO_GUIDE } from "./demoGuide";

const talk = [{ id: "s5", title: "Step 5 · A low-risk read is allowed automatically", step: "allow", say: "Run a read.", run: [{ uc: "UC1", label: "Run a read" }] }];
const prompts = DEMO_CASES.filter((c) => c.uc).map((c) => ({ uc: c.uc, text: `type for ${c.id}` }));
const cast = { castFareRule: true };

describe("the Talk track's eight cases", () => {
  test("only the airline pack (a fare rule) has them", () => {
    expect(casesFor(cast)).toBe(DEMO_CASES);
    expect(casesFor({})).toBeNull();
    expect(DEMO_CASES).toHaveLength(8);
  });

  test("every case names an agenda step, runs one of three ways, and says what to say and where to jump", () => {
    for (const c of DEMO_CASES) {
      expect(DEMO_GUIDE.some((g) => g.id === c.stepId), c.id).toBe(true);
      expect([!!c.uc, !!c.compare, !!c.history].filter(Boolean), c.id).toHaveLength(1);
      expect(c.explain && c.show && c.say.length && c.links.length, c.id).toBeTruthy();
      expect([c.title, c.explain, c.show, ...c.say, ...c.links.map((l) => l.label)].join(" "), c.id).not.toMatch(/\bUC[-\w.]*\d/); // ids stay in data (`uc`), never in the words
    }
    for (const c of DEMO_CASES) expect([c.title, c.explain, c.show, ...c.say, ...c.links.map((l) => l.label)].join(" ")).not.toMatch(/\b(mock|simulat|fake|engine|scripted)/i);
  });

  test("no cases without the prop: the plain talk track, unchanged", () => {
    render(<TalkTrack talk={talk} onClose={() => {}} />);
    expect(screen.queryByTestId("talk-cases")).toBeNull();
    expect(screen.getByTestId("talk-track")).toBeTruthy();
  });

  test("the list is on the left; a click shows the requirement, the prompt, the explanation and the talking points; Run and the links call back", () => {
    const onCase = vi.fn(); const onLink = vi.fn();
    render(<TalkTrack talk={talk} cases={DEMO_CASES} cast={cast} prompts={prompts} onCase={onCase} onLink={onLink} onClose={() => {}} />);
    expect(screen.getAllByRole("button").filter((b) => b.dataset.testid?.startsWith("case-pick-"))).toHaveLength(8);
    expect(screen.getByTestId("case-detail").dataset.case).toBe("booked-as-asked");
    expect(screen.getByTestId("case-prompt").textContent).toContain("type for booked-as-asked");

    fireEvent.click(screen.getByTestId("case-pick-person-approves"));
    const detail = screen.getByTestId("case-detail");
    expect(detail.dataset.case).toBe("person-approves");
    expect(screen.getByTestId("case-requirement").textContent).toMatch(/denied, constrained or routed for approval/);
    expect(screen.getByTestId("case-prompt").textContent).toContain("type for person-approves");
    expect(screen.getByTestId("case-explain").textContent).toMatch(/Over \$1,500/);
    expect(screen.getByTestId("case-say").querySelectorAll("li").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByTestId("case-run"));
    expect(onCase).toHaveBeenCalledWith(expect.objectContaining({ id: "person-approves", uc: "UC6" }));
    fireEvent.click(screen.getByTestId("case-link-runs"));
    expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ kind: "runs" }), expect.objectContaining({ id: "person-approves" }));
  });

  test("the two cases that type nothing say what to press, and Previous / Next walk the eight", () => {
    render(<TalkTrack talk={talk} cases={DEMO_CASES} cast={cast} prompts={prompts} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("case-pick-poisoned-instructions"));
    expect(screen.getByTestId("case-prompt").textContent).toMatch(/Press.*Open Compare/);
    expect(screen.getByTestId("case-run").textContent).toBe("Open Compare at this pair");
    fireEvent.click(screen.getByTestId("case-next"));
    expect(screen.getByTestId("case-detail").dataset.case).toBe("audit-trail");
    expect(screen.getByTestId("case-run").textContent).toBe("Open Run history");
    expect(screen.getByTestId("case-next").disabled).toBe(true);
    fireEvent.click(screen.getByTestId("case-prev"));
    expect(screen.getByTestId("case-detail").dataset.case).toBe("poisoned-instructions");
  });
});
