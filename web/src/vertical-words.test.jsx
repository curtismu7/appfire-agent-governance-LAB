import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SetupSidebar from "./components/SetupSidebar";
import AgendaSteps from "./components/AgendaSteps";
import { Refusal } from "./components/RunPanel";
import { WhatToType } from "./components/AgentColumn";
import { REAL_VERTICAL_NOTE } from "./lib";
import DemoGuide from "./components/DemoGuide";

// The words that name a vertical or a Real limit come from the loaded vertical list and the cast, never from a typed list of names.
const VERTICALS = [
  { id: "software", label: "Appfire Work Suite", pack: "full" }, { id: "banking", label: "Appfire Platform", pack: "full" },
  { id: "healthcare", label: "Appfire Health Suite", pack: "full" }, { id: "retail", label: "Appfire Retail Suite", pack: "full" }, { id: "government", label: "Government", pack: "stub" },
];
afterEach(cleanup);

const sidebar = (over) => render(<SetupSidebar onNewChat={() => {}} mode="mock" host="appfire-work" several={false} setSeveral={() => {}} agent="release-assistant" vertical="software" verticals={VERTICALS} onVertical={() => {}} sessions={[]} onSession={() => {}} {...over} />);

describe("the Real note beside the vertical menu", () => {
  test("in Real mode on a vertical the SE gateway does not serve, one plain line says which verticals Real needs", () => {
    sidebar({ mode: "live", vertical: "software" });
    expect(screen.getByTestId("real-vertical-note").textContent).toBe(REAL_VERTICAL_NOTE);
    expect(screen.getByTestId("real-vertical-note").textContent).toMatch(/Real runs need the Banking, Healthcare or Retail vertical today/);
  });
  test("no note in Mock, and none on the Banking vertical itself", () => {
    sidebar({ mode: "mock", vertical: "software" });
    expect(screen.queryByTestId("real-vertical-note")).toBeNull();
    cleanup();
    sidebar({ mode: "live", vertical: "banking" });
    expect(screen.queryByTestId("real-vertical-note")).toBeNull();
    cleanup();
    sidebar({ mode: "live", vertical: "healthcare" }); // the gateway serves healthcare and retail tools, so the note does not apply
    expect(screen.queryByTestId("real-vertical-note")).toBeNull();
  });
  test("the vertical menu lists the software pack first among the full packs", () => {
    sidebar({});
    const full = [...screen.getByTestId("vertical").querySelectorAll("optgroup")[0].querySelectorAll("option")].map((o) => o.textContent);
    expect(full).toEqual(["Appfire Work Suite", "Appfire Platform", "Appfire Health Suite", "Appfire Retail Suite"]);
  });
});

describe("messages that name the full packs", () => {
  test("a stub vertical's chat notice is built from the loaded list, and names Software", () => {
    render(<WhatToType prompts={[]} vertical="government" verticalLabel="Government" verticals={VERTICALS} stub typeAndSend={() => {}} />);
    expect(screen.getByTestId("wtt-stub").textContent).toBe("Government: no demo pack yet. Pick Software, Banking, Healthcare or Retail to chat.");
  });
  test("before the list loads the notice is generic", () => {
    render(<WhatToType prompts={[]} vertical="government" verticalLabel="Government" stub typeAndSend={() => {}} />);
    expect(screen.getByTestId("wtt-stub").textContent).toBe("Government: no demo pack yet. Pick one of the full-pack verticals to chat.");
  });
  test("the run panel's not-built answer names the full packs from the list when the server sends no words", () => {
    render(<Refusal result={{ ok: false, status: 501, body: { error: "vertical_stub" } }} verticals={VERTICALS} />);
    expect(screen.getByTestId("refusal").textContent).toMatch(/Pick Software, Banking, Healthcare or Retail to run\./);
  });
});

describe("the Presenter bar's buttons read naturally for the vertical", () => {
  test("step 1's run button says a low-risk read, not a balance", () => {
    render(<AgendaSteps step={0} onStep={() => {}} onRun={() => {}} onCompare={() => {}} activeUc={null} cast={{ castUser: "maya.chen" }} prompts={[]} />);
    expect(screen.getByTestId("agenda-run-UC1").textContent).toBe("Start the workflow: a low-risk read");
    expect(screen.getByTestId("agenda-now").textContent).not.toMatch(/balance|transfer|\$\d/i);
  });
});

describe("the Demo guide's Real list", () => {
  const catalog = (real) => ({ tracks: [{ track: "foundations", usecases: [{ id: "UC1", title: "Delegated access (consent only)", realGate: { real, reason: "the SE gateway serves no tool of this vertical (banking, healthcare and retail only)" } }] }] });
  const guide = (c) => render(<DemoGuide isOpen onClose={() => {}} catalog={c} cast={{}} prompts={[]} />);
  test("a vertical with no use case that runs Real says so, and lists none under a Runs Real heading", () => {
    guide(catalog(false));
    expect(screen.getByTestId("guide-real-none").textContent).toMatch(/No use case runs the live chain in this vertical/);
    expect(screen.queryByTestId("guide-real-list")).toBeNull();
    expect(screen.getByTestId("guide-blocked-list").textContent).toMatch(/Delegated access/);
  });
  test("a vertical with use cases that run Real keeps the count and the list", () => {
    guide(catalog(true));
    expect(screen.queryByTestId("guide-real-none")).toBeNull();
    expect(screen.getByTestId("guide-real-list").textContent).toMatch(/Delegated access/);
  });
});
