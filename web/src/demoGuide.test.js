import { describe, expect, test } from "vitest";
import { DEMO_GUIDE, TOPICS, buttonKey, fillGuide, guideStep, promptGroups, promptsOfStep, topicOfStep } from "./demoGuide";
import { PRESETS, presetFor } from "./compare";

// The software cast and a few of its typed prompts, as the page receives them (/api/story cast, /api/prompts). The banking cast is the other end of the same fill.
const SOFTWARE = { castBrand: "Appfire Work Suite", castUser: "maya.chen", castAgent: "release-assistant", castAsset: "project", castAction: "bulk edit", castGroup: "enterprise-tier" };
const BANKING = { castBrand: "Appfire Platform", castUser: "alex.morgan", castAgent: "triage-agent", castAsset: "account", castAction: "transfer", castGroup: "premium-tier" };
const SOFT_PROMPTS = [
  { uc: "UC1", text: "show my open issues" }, { uc: "UC7", text: "bulk-edit 600 issues in the Billing project and move them to Done" },
  { uc: "UC8", text: "bulk-edit 300 issues in the Billing project and move them to Done" }, { uc: "UC6", text: "bulk-edit 2500 issues across all projects and move them to Done" },
  { uc: "UC21", text: "show the security settings of the restricted Billing project (check tier access)" },
];
const BANK_WORDS = /\b(balance|transfer|checking|savings|mortgage|bank(ing)?|deposit|portfolio|branch(es)?|fee waiver|credit)\b|\$\d|alex\.morgan/i;
const everyWalkthroughString = (steps) => steps.flatMap((g) => [g.title, g.req, g.prove, g.say, ...g.ucs.map((b) => b.label)]);

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

  test("the walkthrough and the Compare presets carry no banking words: they are neutral or filled from the cast", () => {
    for (const t of everyWalkthroughString(DEMO_GUIDE)) expect(t).not.toMatch(BANK_WORDS);
    for (const p of PRESETS) for (const t of [p.title, p.why, ...p.sides.map((x) => x.label)]) expect(t).not.toMatch(BANK_WORDS);
  });

  test("fillGuide fills the cast and the vertical's typed prompts, with neutral words when either is missing; an unknown token is left visible", () => {
    const ctx = { cast: SOFTWARE, prompts: SOFT_PROMPTS };
    expect(fillGuide("{{castUser}} asks {{castAgent}} at {{castBrand}}", ctx)).toBe("maya.chen asks release-assistant at Appfire Work Suite");
    expect(fillGuide("Run {{prompt:UC1|a low-risk read}}.", ctx)).toBe("Run “show my open issues”.");
    expect(fillGuide("Run {{prompt:UC30|a low-risk read}}.", ctx)).toBe("Run a low-risk read.");
    expect(fillGuide("Run {{prompt:UC30}}.", ctx)).toBe("Run the matching prompt in What to type.");
    // before the story and the prompts load
    expect(fillGuide("{{castUser}} signs in to {{castBrand}}; a {{castAction}} on the {{castAsset}}", {})).toBe("the signed-in person signs in to the app; a write on the resource");
    expect(fillGuide("{{nope}} {{prompt:UC2.6|x}}", ctx)).toBe("{{nope}} x");
    // a typed prompt is text, never a token to fill again
    expect(fillGuide("{{prompt:UC1}}", { prompts: [{ uc: "UC1", text: "{{castUser}}" }] })).toBe("“{{castUser}}”");
  });

  test("guideStep fills every string of a step for the software cast and for the banking cast, and leaves no token behind", () => {
    for (const ctx of [{ cast: SOFTWARE, prompts: SOFT_PROMPTS }, { cast: BANKING, prompts: [] }, {}]) {
      const filled = DEMO_GUIDE.map((g) => guideStep(g, ctx));
      for (const t of everyWalkthroughString(filled)) expect(t).not.toMatch(/\{\{/);
      expect(filled.map((g) => g.id)).toEqual(DEMO_GUIDE.map((g) => g.id));
      expect(filled.map((g) => g.ucs.map(buttonKey))).toEqual(DEMO_GUIDE.map((g) => g.ucs.map(buttonKey)));
    }
    const soft = DEMO_GUIDE.map((g) => guideStep(g, { cast: SOFTWARE, prompts: SOFT_PROMPTS }));
    for (const t of everyWalkthroughString(soft)) expect(t).not.toMatch(BANK_WORDS);
    expect(soft[0].prove).toBe("Run “show my open issues”. The sequence opens with the sign-in and prompt hops: maya.chen signs in to Appfire Work Suite and asks release-assistant for something. The simulation banner says what is mock; HIVE is never called.");
    expect(soft[3].prove).toMatch(/same project/); expect(soft[3].prove).toMatch(/enterprise-tier group/);
    expect(soft[5].prove).toMatch(/“bulk-edit 600 issues in the Billing project and move them to Done” steps up/);
    expect(soft[5].prove).toMatch(/another person's private project/);
    // the same words for banking still name the banking things, from the banking cast
    const bank = guideStep(DEMO_GUIDE[5], { cast: BANKING, prompts: [{ uc: "UC7", text: "transfer $600 from checking to savings" }] });
    expect(bank.prove).toMatch(/“transfer \$600 from checking to savings” steps up/); expect(bank.prove).toMatch(/private account/);
    expect(guideStep(null, {})).toBeNull();
  });

  test("presetFor fills a Compare preset's words from the vertical; the use cases and personas it runs are untouched", () => {
    const soft = PRESETS.map((p) => presetFor(p, { cast: SOFTWARE, prompts: SOFT_PROMPTS }));
    for (const p of soft) for (const t of [p.title, p.why, ...p.sides.map((x) => x.label)]) expect(t).not.toMatch(/\{\{|\$\d|transfer|balance/i);
    expect(soft.find((p) => p.id === "stepup-person").sides.map((x) => x.label)).toEqual(["a bulk edit held for a second factor", "a bulk edit held for a person"]);
    expect(soft.find((p) => p.id === "ask-refuse").why).toMatch(/^A bulk edit above the first threshold/);
    expect(soft.find((p) => p.id === "careful-poisoned").why).toMatch(/^maya\.chen asks for a low-risk read both times/);
    expect(soft.map((p) => p.sides.map((x) => [x.uc, x.persona, x.instructionsPreset]))).toEqual(PRESETS.map((p) => p.sides.map((x) => [x.uc, x.persona, x.instructionsPreset])));
    expect(presetFor(PRESETS[1], { cast: BANKING }).sides[0].label).toBe("a transfer held for a second factor");
  });

  test("steps 5 and 6 list the extra prompts a vertical offers: the allowed third-party call, then the refusals and the lower approval rung", () => {
    const ucs = ["UC1", "UC33", "UC7", "UC8", "UC22", "UC6", "UC9", "UC21", "UC34", "UC35", "UC24", "UC2", "UC2.6", "UC13", "UC28", "UC30", "UC31", "UC10", "UC27"];
    const list = ucs.map((uc) => ({ uc, text: `t-${uc}` }));
    expect(promptsOfStep("allow", list).map((p) => p.uc)).toEqual(["UC1", "UC30"]);
    expect(promptsOfStep("escalate", list).map((p) => p.uc)).toEqual(["UC7", "UC8", "UC22", "UC6", "UC31", "UC10", "UC27", "UC13"]);
    const { groups, more } = promptGroups(list);
    expect(groups.find((g) => g.id === "allow").items.map((p) => p.uc)).toEqual(["UC30"]); // UC1 is listed once, under step 1
    expect(more.map((p) => p.uc)).toEqual(["UC33", "UC24", "UC2", "UC2.6", "UC28"]);
  });
});
