import { describe, expect, test } from "vitest";
import { DEMO_GUIDE, TOPICS, buttonKey, promptGroups, promptsOfStep, topicOfStep } from "./demoGuide";
import { PRESETS } from "./compare";

describe("demoGuide", () => {
  test("no name a presenter reads carries a use case id", () => {
    for (const g of DEMO_GUIDE) {
      expect(g.title).not.toMatch(/UC\d/);
      for (const b of g.ucs) { expect(b.label).not.toMatch(/UC\d/); if (b.compare) expect(PRESETS.map((p) => p.id)).toContain(b.compare); else expect(b.uc).toMatch(/^UC\d+$/); }
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

  test("step 6 offers the four risk runs, the third-party refusal, the forged actor, and two Compare pairs; buttons have distinct keys", () => {
    const step6 = DEMO_GUIDE.find((g) => g.id === "escalate");
    expect(step6.ucs.map((b) => b.label)).toEqual(["Higher risk: needs a second factor", "Higher risk: needs a person's approval", "Out of bounds: refused", "Out of scope: refused", "Manipulated agent: refused", "Poisoned instructions: refused", "Compare two runs"]);
    expect(step6.ucs.filter((b) => b.compare).map((b) => b.compare)).toEqual(["careful-poisoned", "ask-refuse"]);
    expect(new Set(step6.ucs.map(buttonKey)).size).toBe(step6.ucs.length);
  });

  test("each step names its typed prompts; the full list groups under the steps in agenda order, each prompt once, the rest last", () => {
    const list = ["UC1", "UC33", "UC7", "UC8", "UC6", "UC9", "UC21", "UC34", "UC35", "UC24", "UC2", "UC2.6", "UC13", "UC28"].map((uc) => ({ uc, text: `t-${uc}` }));
    expect(promptsOfStep("evaluate", list).map((p) => p.uc)).toEqual(["UC21", "UC9"]);
    expect(promptsOfStep("escalate", list).map((p) => p.uc)).toEqual(["UC7", "UC8", "UC6", "UC13"]);
    expect(promptsOfStep("nope", list)).toEqual([]);
    const { groups, more } = promptGroups(list);
    expect(groups.map((g) => `${g.n}:${g.id}:${g.items.map((p) => p.uc).join(",")}`)).toEqual(["1:start:UC1", "4:evaluate:UC21,UC9", "6:escalate:UC7,UC8,UC6,UC13", "7:audit:UC35,UC34"]);
    expect(more.map((p) => p.uc)).toEqual(["UC33", "UC24", "UC2", "UC2.6", "UC28"]);
    const all = [...groups.flatMap((g) => g.items), ...more].map((p) => p.uc);
    expect(new Set(all).size).toBe(list.length);
    // a list missing some use cases (another vertical) just has fewer
    expect(promptGroups([{ uc: "UC9", text: "x" }]).groups.map((g) => g.id)).toEqual(["evaluate"]);
  });
});

