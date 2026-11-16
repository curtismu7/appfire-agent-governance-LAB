import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SourceTag, chipsNeeded, hopSource, mixedRun } from "./Bits";
import { HopSources } from "./EvidenceColumn";

afterEach(cleanup);

// Owner, 2026-11-16: "we know what it is". A REAL or MOCK chip per hop shows only when it tells something the page does not.
const hops = (...sources) => sources.map((source, i) => ({ n: i + 1, title: `Hop ${i + 1}`, kind: `k${i}`, source }));

describe("when the REAL / MOCK chips are needed", () => {
  test("a run of one kind needs none: all mock, or all real with some steps not run", () => {
    expect(chipsNeeded({ kind: "mock", hops: hops("mock", "mock", "not-run") })).toBe(false);
    expect(chipsNeeded({ kind: "real", hops: hops("real", "real", "not-run", "not-run") })).toBe(false);
    expect(chipsNeeded(null)).toBe(false);
  });
  test("a mixed run needs them: some hops real, some on the mock engine", () => {
    const run = { kind: "real", hops: hops("real", "mock", "real") };
    expect(mixedRun(run)).toBe(true);
    expect(chipsNeeded(run)).toBe(true);
  });
  test("a Real-mode page whose use case cannot run Real needs them: the mock engine ran it while the Mode switch says Real", () => {
    expect(chipsNeeded({ kind: "mock", hops: hops("mock", "mock"), realGate: { real: false, reason: "needs a model" } })).toBe(true);
    expect(chipsNeeded({ kind: "real", hops: hops("real"), realGate: { real: true } })).toBe(false);
  });
  test("a hop with no source takes it from the run: mock flag, else the run's kind", () => {
    expect(hopSource({ mock: true }, { kind: "real" })).toBe("mock");
    expect(hopSource({}, { kind: "real" })).toBe("real");
    expect(hopSource({}, { kind: "live" })).toBe("real");
    expect(hopSource({}, { kind: "mock" })).toBe("mock");
  });
});

describe("SourceTag", () => {
  test("NOT RUN always shows; REAL and MOCK follow show", () => {
    const { rerender } = render(<SourceTag source="not-run" show={false} />);
    expect(screen.getByTestId("notrun-tag").textContent).toBe("NOT RUN");
    rerender(<SourceTag source="real" show={false} />);
    expect(screen.queryByTestId("real-tag")).toBeNull();
    rerender(<SourceTag source="mock" show={false} />);
    expect(screen.queryByTestId("mock-tag")).toBeNull();
    rerender(<SourceTag source="mock" show />);
    expect(screen.getByTestId("mock-tag").textContent).toBe("MOCK");
    rerender(<SourceTag source="real" />);
    expect(screen.getByTestId("real-tag").textContent).toBe("REAL");
  });
});

describe("the hop list (Where each hop ran)", () => {
  const chips = (run) => { render(<HopSources run={run} />); return within(screen.getByTestId("hop-sources")); };
  test("one kind: no REAL or MOCK chip, but NOT RUN stays", () => {
    const list = chips({ kind: "real", hops: hops("real", "real", "not-run") });
    expect(list.queryByTestId("real-tag")).toBeNull();
    expect(list.queryByTestId("mock-tag")).toBeNull();
    expect(list.getAllByTestId("notrun-tag")).toHaveLength(1);
  });
  test("a mixed run: every real and mock hop carries its chip", () => {
    const list = chips({ kind: "real", hops: hops("real", "mock", "not-run") });
    expect(list.getAllByTestId("real-tag")).toHaveLength(1);
    expect(list.getAllByTestId("mock-tag")).toHaveLength(1);
    expect(list.getAllByTestId("notrun-tag")).toHaveLength(1);
  });
  test("the mock engine in a Real-mode page keeps its MOCK chips and says why", () => {
    const list = chips({ kind: "mock", hops: hops("mock", "mock"), realGate: { real: false, reason: "needs a model" } });
    expect(list.getAllByTestId("mock-tag")).toHaveLength(2);
    expect(list.getByTestId("hop-sources-why").textContent).toMatch(/cannot run Real/);
  });
});
