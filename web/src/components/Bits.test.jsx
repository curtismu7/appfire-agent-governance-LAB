import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as Bits from "./Bits";
import * as Evidence from "./EvidenceColumn";
import { SourceTag } from "./Bits";

afterEach(cleanup);

// Owner, 2026-11-16: "everything should be real mode ... demo watchers do not need to know." No REAL, MOCK or LIVE chip on any hop, token or page:
// where a hop was produced is data (hop.source), not a label. NOT RUN is a status and stays.
describe("SourceTag", () => {
  test("NOT RUN shows; every other source renders nothing", () => {
    const { rerender, container } = render(<SourceTag source="not-run" />);
    expect(screen.getByTestId("notrun-tag").textContent).toBe("NOT RUN");
    for (const source of ["real", "mock", "live", undefined]) {
      rerender(<SourceTag source={source} />);
      expect(container.textContent).toBe("");
    }
  });
});

describe("the chips are gone", () => {
  test("Bits no longer exports a REAL, MOCK or LIVE chip or the helpers that decided when to show them", () => {
    for (const name of ["RealTag", "MockTag", "LiveTag", "chipsNeeded", "mixedRun", "hopSource"]) expect(Bits[name]).toBeUndefined();
  });
  test("the evidence column no longer draws a 'where each hop ran' list", () => {
    expect(Evidence.HopSources).toBeUndefined();
  });
});
