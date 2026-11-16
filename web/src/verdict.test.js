import { describe, expect, test } from "vitest";
import { verdictState, verdictWord } from "./evidence/lanes";

describe("verdict words", () => {
  test("a hop with no decision says so (a gateway that did not answer is not a denial), in the warning colour", () => {
    expect(verdictWord("error")).toBe("no decision");
    expect(verdictState("error")).toBe("warn");
    expect(verdictWord("deny")).toBe("denied");
    expect(verdictState("deny")).toBe("bad");
  });
});
