import { describe, expect, test } from "vitest";
import { DEMO_GUIDE, TOPICS, topicOfStep } from "./demoGuide";

describe("demoGuide", () => {
  test("no name a presenter reads carries a use case id", () => {
    for (const g of DEMO_GUIDE) {
      expect(g.title).not.toMatch(/UC\d/);
      for (const b of g.ucs) { expect(b.label).not.toMatch(/UC\d/); expect(b.uc).toMatch(/^UC\d+$/); }
    }
  });

  test("seven timed topics; only the 0:25 and 0:40 topics run in the lab", () => {
    expect(TOPICS.map((t) => t.time)).toEqual(["0:00", "0:05", "0:15", "0:25", "0:40", "0:50", "0:55"]);
    expect(TOPICS.filter((t) => t.inLab).map((t) => t.time)).toEqual(["0:25", "0:40"]);
  });

  test("topicOfStep maps steps 1 to 5 to the 0:25 topic and steps 6 and 7 to the 0:40 topic", () => {
    for (const id of ["start", "identity", "call", "evaluate", "allow"]) expect(topicOfStep(id).time).toBe("0:25");
    for (const id of ["escalate", "audit"]) expect(topicOfStep(id).time).toBe("0:40");
    expect(topicOfStep("nope")).toBeNull();
    expect(DEMO_GUIDE.every((g) => topicOfStep(g.id)?.inLab)).toBe(true);
  });
});
