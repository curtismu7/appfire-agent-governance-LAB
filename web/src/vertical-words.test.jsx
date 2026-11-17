import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SetupSidebar from "./components/SetupSidebar";
import AgendaSteps from "./components/AgendaSteps";
import { Refusal } from "./components/RunPanel";
import { WhatToType } from "./components/AgentColumn";
import DemoGuide from "./components/DemoGuide";

// The words that name a vertical come from the loaded vertical list and the cast, never from a typed list of names.
const VERTICALS = [
  { id: "airline", label: "Larkspur Air", pack: "full" }, { id: "software", label: "Appfire Work Suite", pack: "full" }, { id: "banking", label: "Appfire Platform", pack: "full" },
  { id: "healthcare", label: "Appfire Health Suite", pack: "full" }, { id: "retail", label: "Appfire Retail Suite", pack: "full" }, { id: "government", label: "Government", pack: "stub" },
];
afterEach(cleanup);

const sidebar = (over) => render(<SetupSidebar onNewChat={() => {}} mode="mock" host="appfire-work" several={false} setSeveral={() => {}} agent="release-assistant" vertical="software" verticals={VERTICALS} onVertical={() => {}} sessions={[]} onSession={() => {}} {...over} />);

describe("the vertical menu", () => {
  test("no note about which verticals Real needs, in any mode, on any vertical", () => {
    for (const [mode, vertical] of [["live", "software"], ["live", "banking"], ["mock", "software"]]) {
      sidebar({ mode, vertical });
      expect(screen.queryByTestId("real-vertical-note")).toBeNull();
      expect(screen.getByTestId("setup").textContent).not.toMatch(/Real|mock|simulat|offline/i);
      cleanup();
    }
  });
  test("the vertical menu lists the airline pack first among the full packs", () => {
    sidebar({});
    const full = [...screen.getByTestId("vertical").querySelectorAll("optgroup")[0].querySelectorAll("option")].map((o) => o.textContent);
    expect(full).toEqual(["Larkspur Air", "Appfire Work Suite", "Appfire Platform", "Appfire Health Suite", "Appfire Retail Suite"]);
  });
});

describe("messages that name the full packs", () => {
  test("a stub vertical's chat notice is built from the loaded list, and names the full packs from the list", () => {
    render(<WhatToType prompts={[]} vertical="government" verticalLabel="Government" verticals={VERTICALS} stub typeAndSend={() => {}} />);
    expect(screen.getByTestId("wtt-stub").textContent).toBe("Government: no demo pack yet. Pick Airline, Software, Banking, Healthcare or Retail to chat.");
  });
  test("before the list loads the notice is generic", () => {
    render(<WhatToType prompts={[]} vertical="government" verticalLabel="Government" stub typeAndSend={() => {}} />);
    expect(screen.getByTestId("wtt-stub").textContent).toBe("Government: no demo pack yet. Pick one of the full-pack verticals to chat.");
  });
  test("the run panel's not-built answer names the full packs from the list when the server sends no words", () => {
    render(<Refusal result={{ ok: false, status: 501, body: { error: "vertical_stub" } }} verticals={VERTICALS} />);
    expect(screen.getByTestId("refusal").textContent).toMatch(/Pick Airline, Software, Banking, Healthcare or Retail to run\./);
  });
});

describe("the Presenter bar's buttons read naturally for the vertical", () => {
  test("step 1's run button says a low-risk read, not a balance", () => {
    render(<AgendaSteps step={0} onStep={() => {}} onRun={() => {}} onCompare={() => {}} activeUc={null} cast={{ castUser: "maya.chen" }} prompts={[]} />);
    expect(screen.getByTestId("agenda-run-UC1").textContent).toBe("Start the workflow: a low-risk read");
    expect(screen.getByTestId("agenda-now").textContent).not.toMatch(/balance|transfer|\$\d/i);
  });
});

describe("the Demo guide", () => {
  const catalog = (real) => ({ tracks: [{ track: "foundations", usecases: [{ id: "UC1", title: "Delegated access (consent only)", realGate: { real, reason: "the SE gateway serves no tool of this vertical (banking, healthcare and retail only)" } }] }] });
  test("it has no list of what runs Real or Mock, whatever the catalog's gate says", () => {
    for (const real of [false, true]) {
      render(<DemoGuide isOpen onClose={() => {}} catalog={catalog(real)} cast={{}} prompts={[]} />);
      for (const id of ["guide-real-help", "guide-real-none", "guide-real-list", "guide-blocked-list", "guide-real-vertical"]) expect(screen.queryByTestId(id)).toBeNull();
      expect(screen.getByTestId("demo-guide").textContent).not.toMatch(/Real mode|Runs Real|Runs Mock|mock engine|MOCK/);
      cleanup();
    }
  });
});
