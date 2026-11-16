import { describe, expect, test } from "vitest";
import { DEFAULT_VERTICAL, EXTRAS, NEEDS_LABELS, TRACK_LABELS, extraHops, fullPackNames, haystack, joinOr, newTraceparent, outcomeState, pickFullPack, triggerText, verdictState , holdWords, verticalName } from "./lib";
import { visible } from "./safeText";
import { USECASES } from "./testFixtures";

describe("lib", () => {
  test("the eight tracks and eight needs all have labels", () => {
    expect(Object.keys(TRACK_LABELS)).toEqual(["foundations", "learn", "controls", "hitl", "demo", "attacks", "tools", "nhi"]);
    expect(Object.keys(NEEDS_LABELS)).toHaveLength(8);
  });
  test("every `opens` value the manifest can hold has an extra page definition (and `none` has not)", () => {
    expect(Object.keys(EXTRAS).sort()).toEqual(["a2a", "approval", "consent", "group-board", "learning-link", "obo"]);
    expect(Object.hasOwn(EXTRAS, "none")).toBe(false);
  });
  test("outcomes map to states by word, with refusals bad and held ones warn", () => {
    expect(["PERMIT", "DELEGATE_AND_EXECUTE"].map(outcomeState)).toEqual(["ok", "ok"]);
    expect(["DENY", "DENY_401", "DENY_429", "PERMIT_THEN_DENY"].map(outcomeState)).toEqual(["bad", "bad", "bad", "bad"]);
    expect(["STEP_UP", "HITL_REQUIRED"].map(outcomeState)).toEqual(["warn", "warn"]);
    expect(outcomeState("GUIDED_LEARNING")).toBe("info");
    expect(["ok", "held", "refused", undefined].map(verdictState)).toEqual(["ok", "warn", "bad", "info"]);
  });
  test("extraHops keeps the hops of that page's kinds (prefix kinds end in a dash) and falls back to all", () => {
    const hops = ["sign-in", "consent", "a2a-agent-card", "id-jag-issued", "tool-dispatched"].map((kind, i) => ({ n: i + 1, kind }));
    expect(extraHops("consent", hops).map((h) => h.kind)).toEqual(["sign-in", "consent"]);
    expect(extraHops("a2a", hops).map((h) => h.kind)).toEqual(["a2a-agent-card", "id-jag-issued"]);
    expect(extraHops("obo", hops).map((h) => h.kind)).toEqual(["id-jag-issued"]);
    expect(extraHops("approval", [{ n: 1, kind: "sign-in" }])).toHaveLength(1);
    expect(extraHops("__proto__", hops)).toHaveLength(5);
  });
  test("triggers are plain text and a link names a path as a label", () => {
    expect(triggerText({ type: "chip", text: "show my balance" })).toBe('chat chip: "show my balance"');
    expect(triggerText({ type: "link", path: "/x" })).toBe("AI-DEMO2 page (label only): /x");
    expect(triggerText({ type: "edu", panel: "id-jag", tab: "how" })).toBe("AI-DEMO2 panel (label only): id-jag / how");
    expect(triggerText({ type: "attack", sim: "wrong-aud" })).toBe("staged attack: wrong-aud");
    expect(triggerText(null)).toBe("");
  });
  test("haystack covers id, title, needs, flag and trigger, lower-cased", () => {
    const h = haystack(USECASES[2]);
    for (const w of ["uc9", "group-gated", "authz", "ff_authorize_group_policy", "show my balance"]) expect(h).toContain(w);
  });
  test("newTraceparent is a valid W3C traceparent, never all zero, and fresh each time", () => {
    const a = newTraceparent(), b = newTraceparent();
    expect(a).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^00-0{32}/);
  });
  test("visible() turns control and bidi characters into visible escapes and keeps newlines", () => {
    expect(visible("a‮b​c\u0000d\ne")).toBe("a\\u202eb\\u200bc\\u0000d\ne");
    expect(visible(null)).toBe("null");
  });
});

describe("the phone's words", () => {
  test("say the control that held the call, in the agenda's words, and never a use-case id", () => {
    expect(holdWords("STEP_UP")).toBe("A higher-risk write needs a second factor");
    expect(holdWords("HITL_REQUIRED")).toBe("A higher-risk write needs a person to approve it");
    expect(holdWords("REAL_HOLD")).toBe("The gateway holds this call for approval");
    for (const o of ["STEP_UP", "HITL_REQUIRED", "REAL_HOLD", undefined, "x"]) expect(holdWords(o)).not.toMatch(/\bUC\d/);
  });
  test("the page opens on the software vertical", () => {
    expect(DEFAULT_VERTICAL).toBe("software");
  });
  test("a sentence that names the full packs is built from the loaded list, never typed by hand", () => {
    const list = [{ id: "software", pack: "full" }, { id: "banking", pack: "full" }, { id: "healthcare", pack: "full" }, { id: "retail", pack: "full" }, { id: "sporting-goods", pack: "stub" }];
    expect(fullPackNames(list)).toEqual(["Software", "Banking", "Healthcare", "Retail"]);
    expect(pickFullPack(list)).toBe("Pick Software, Banking, Healthcare or Retail");
    expect(pickFullPack([{ id: "banking", pack: "full" }, { id: "retail", pack: "full" }])).toBe("Pick Banking or Retail");
    expect(pickFullPack([{ id: "retail", pack: "full" }])).toBe("Pick Retail");
    expect(pickFullPack([])).toBe("Pick one of the full-pack verticals"); // before the list loads
    expect(pickFullPack(undefined)).toBe("Pick one of the full-pack verticals");
    expect(verticalName("sporting-goods")).toBe("Sporting goods");
    expect(joinOr(["a", "b", "c"])).toBe("a, b or c");
    expect(joinOr([])).toBe("");
  });
  test("lib.js carries no note about Real runs and no hosted Real note", async () => {
    const lib = await import("./lib");
    expect(lib.REAL_VERTICAL_NOTE).toBeUndefined();
    expect(lib.HOSTED_REAL_NOTE).toBeUndefined();
  });

});
