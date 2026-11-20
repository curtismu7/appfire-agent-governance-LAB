import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramView from "./components/DiagramView";
import PatternDiagram, { edgeSides, toLabelItems } from "./components/PatternDiagram";
import { DIAGRAM, mockApi, runBody } from "./testFixtures";
import { forgetWorkspace } from "./workspace";

let api;
beforeEach(() => { window.sessionStorage.clear(); forgetWorkspace(); api = mockApi(); vi.stubGlobal("fetch", api); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the diagram is data loaded by name (rule 17)", () => {
  test("DiagramView asks the server for the diagram by name and vertical, and offers every name the server lists", async () => {
    render(<DiagramView vertical="healthcare" resetSignal={0} lastRun={null} />);
    await screen.findByTestId("diagram-canvas");
    const call = api.calls.find((c) => c.path === "/api/diagram");
    expect(call.query.get("name")).toBe("delegation-chain");
    expect(call.query.get("vertical")).toBe("healthcare");
    expect(screen.getByTestId("dg-delegation-chain")).toBeTruthy();
    expect(screen.getByTestId("dg-gateway-refusals")).toBeTruthy();
    await userEvent.setup().click(screen.getByTestId("dg-gateway-refusals"));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/diagram").at(-1).query.get("name")).toBe("gateway-refusals"));
  });

  test("one box per node, with the label from the data; the title and intro come from the data (the arrows need layout, so the real-browser run checks those)", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    expect(screen.getByText(DIAGRAM.diagram.title)).toBeTruthy();
    expect(screen.getByText(DIAGRAM.diagram.intro)).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node")).toHaveLength(DIAGRAM.diagram.nodes.length));
    expect([...document.querySelectorAll(".react-flow__node")].map((n) => n.textContent)).toEqual(["Browser", "Identity provider", "Agent gateway"]);
    expect([...document.querySelectorAll(".dnode")].map((n) => n.getAttribute("data-color"))).toEqual(["blue", "red", "dark"]);
  });

  test("a load failure is shown, not hidden", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    render(<DiagramView vertical="banking" resetSignal={0} lastRun={null} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not load the diagram \(HTTP 500\)/);
  });
});

describe("Simulate, speed, Reset", () => {
  test("Simulate walks the steps in order at the chosen speed and shows the matching hop of your last run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PatternDiagram diagram={DIAGRAM.diagram} lastRun={runBody("UC1")} />);
    fireEvent.change(screen.getByTestId("speed"), { target: { value: "800" } });
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 1: Sign-in/);
    expect(screen.getByTestId("diagram-hop").textContent).toMatch(/In your last run \(UC1\): hop 1/);
    await act(async () => { vi.advanceTimersByTime(850); });
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 2: Consent/);
    await act(async () => { vi.advanceTimersByTime(850); });
    expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 3: Gateway check/);
    expect(screen.queryByTestId("diagram-hop")).toBeNull(); // the last run had no gateway-check hop
  });

  test("the tool-server steps show a hop of your last run only when that hop is that step (a lab-policy or gateway run shows none under the PingOne Authorize title)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const diagram = { ...DIAGRAM.diagram,
      nodes: [{ id: "bff", label: "App", kind: "people", x: 0, y: 0 }, { id: "ts", label: "Lab tool server", kind: "gate", x: 500, y: 0 }, { id: "az", label: "PingOne Authorize (P1AZ)", kind: "ping", x: 500, y: 300 }],
      edges: [{ source: "bff", target: "ts", label: "call" }, { source: "ts", target: "az", label: "decision" }],
      steps: [
      { from: "bff", to: "ts", label: "Lab tool server", say: "The tool server checks the token.", hop: "gateway-check", edge: 0 },
      { from: "ts", to: "az", label: "PingOne Authorize (P1AZ): booking decision", say: "The tool server asks PingOne Authorize.", hop: "authorize-decision", edge: 1 },
    ] };
    const hopOf = (extra) => ({ n: 4, kind: "authorize-decision", label: "Decision", verdict: "ok", ...extra });
    const lastRun = (hops) => ({ run: { useCase: { id: "UC7" }, hops } });
    const second = async (hops) => {
      render(<PatternDiagram diagram={diagram} lastRun={lastRun(hops)} />);
      fireEvent.change(screen.getByTestId("speed"), { target: { value: "800" } });
      fireEvent.click(screen.getByTestId("simulate"));
      await act(async () => { vi.advanceTimersByTime(850); });
      expect(screen.getByTestId("diagram-now").textContent).toMatch(/Step 2: PingOne Authorize/);
      const shown = screen.queryByTestId("diagram-hop");
      cleanup();
      return shown;
    };
    expect(await second([hopOf({ decidedBy: "lab-policy-local", capability: "tools", provider: "local" })])).toBeNull();
    expect(await second([hopOf({ provider: "se", answeredBy: "Agent Gateway (SE)" })])).toBeNull();
    expect(await second([hopOf({ decidedBy: "none", capability: "tools" })])).toBeNull();
    const yes = await second([hopOf({ decidedBy: "pingone-authorize", capability: "tools", provider: "local" })]);
    expect(yes).toBeTruthy();
  });

  test("the speed control offers five step times and is locked while it plays", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    expect(screen.getByTestId("speed").querySelectorAll("option")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("speed").disabled).toBe(true);
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByTestId("speed").disabled).toBe(false);
  });

  test("Reset stops the walkthrough and Moved goes back to 0", async () => {
    render(<PatternDiagram diagram={DIAGRAM.diagram} />);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now")).toBeTruthy();
    fireEvent.click(screen.getByTestId("diagram-reset"));
    expect(screen.queryByTestId("diagram-now")).toBeNull();
    expect(screen.getByTestId("diagram-moved").textContent).toMatch(/Moved: 0 box/);
  });

  test("the page-level Reset (resetSignal) also resets the walkthrough", () => {
    const { rerender } = render(<PatternDiagram diagram={DIAGRAM.diagram} resetSignal={0} />);
    fireEvent.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("diagram-now")).toBeTruthy();
    rerender(<PatternDiagram diagram={DIAGRAM.diagram} resetSignal={1} />);
    expect(screen.queryByTestId("diagram-now")).toBeNull();
  });
});

describe("label and arrow placement (no overlap)", () => {
  const steps = DIAGRAM.diagram.steps;
  const positions = () => Object.fromEntries(DIAGRAM.diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  test("steps along the same pair of boxes get different label handles; a lone step stays on the facing sides", () => {
    const pos = positions();
    const items = toLabelItems(DIAGRAM.diagram, pos, { step: -1 });
    expect(items[0].sourceHandle).not.toBe(items[1].sourceHandle);
    expect(items[2].sourceHandle).toMatch(/[lr]/);
  });
  test("the second arrow along a pair leaves from another side so the two are not drawn on top of each other", () => {
    const pos = positions();
    const first = edgeSides(steps, 0, pos), second = edgeSides(steps, 1, pos);
    expect(first).not.toEqual(second);
    expect(first).toEqual(["b", "t"]);
  });
});

describe("a represented step (HIVE) is drawn dashed", () => {
  const diagram = {
    ...DIAGRAM.diagram,
    groups: { ...DIAGRAM.diagram.groups, appfire: { label: "Appfire (represented, not called)", color: "grey" } },
    nodes: [...DIAGRAM.diagram.nodes, { id: "hive", label: "HIVE (represented, not called)", kind: "appfire", x: 1000, y: 600 }],
    steps: [...DIAGRAM.diagram.steps, { from: "hive", to: DIAGRAM.diagram.nodes[0].id, label: "HIVE (represented, not called)", say: "Never called.", edge: 99, dashed: true }],
  };
  test("the HIVE box is marked represented and its arrow carries the dashed class; the others do not", async () => {
    render(<PatternDiagram diagram={diagram} />);
    await waitFor(() => expect(document.querySelectorAll(".react-flow__node")).toHaveLength(diagram.nodes.length));
    const marked = [...document.querySelectorAll(".dnode")].filter((n) => n.getAttribute("data-represented") === "true");
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toMatch(/HIVE/);
    expect(diagram.steps.filter((s) => s.dashed)).toHaveLength(1);
  });
});
