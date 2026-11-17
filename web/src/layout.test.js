import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The Agent column is twice as tall as it was (owner, 2026-11-16) and its message box stays pinned to the window's bottom edge. jsdom has no layout, so this
// pins the rules themselves: the old cap was max-height: max(420px, calc(100vh - 196px)); twice that is height: max(840px, calc(200vh - 392px)).
const css = fs.readFileSync(path.join(process.cwd(), "src", "layout.css"), "utf8");
const wide = css.match(/@media \(min-width: 900px\) \{[^}]*\.agentcol \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("the Agent column's height", () => {
  test("twice the old cap, no longer sticky to the top or capped by max-height", () => {
    expect(wide).toMatch(/\.agentcol \{ height: max\(840px, calc\(200vh - 392px\)\); \}/);
    expect(wide).not.toMatch(/\.agentcol \{[^}]*(position: sticky|max-height)/);
  });
  test("the transcript scrolls inside it and the message box is pinned to the bottom of the window", () => {
    expect(wide).toMatch(/\.agentcol__scroll \{ flex: 1 1 auto; overflow-y: auto; \}/);
    expect(wide).toMatch(/\.agentcol__compose \{ position: sticky; bottom: 0;/);
    expect(wide).not.toMatch(/\.agentcol__foot \{[^}]*sticky/); // the 190px of instructions and prompt chips must not cover the newest reply
  });
  test("below 900px the column is unchanged: it sizes to its content", () => {
    const base = css.match(/\.agentcol \{ flex: 1 1 clamp[^}]*\}/)?.[0] ?? "";
    expect(base).not.toMatch(/height/);
  });
});

describe("the risk strip: four rungs everywhere, five on the airline pack", () => {
  test("the grid reads its column count from --risk-n and defaults to four, so a four-pack strip is exactly as it was", () => {
    expect(css).toMatch(/\.risk \{ display: grid; grid-template-columns: repeat\(var\(--risk-n, 4\), minmax\(0, 1fr\)\);/);
  });
  test("the blue info tone lights the lit rung (CONSTRAINED is never red) with a token, not a colour literal", () => {
    expect(css).toMatch(/\.decision\[data-tone="info"\] \.risk__rung\[aria-current="step"\] \{ border-color: var\(--status-info\); \}/);
    expect(css.match(/\.decision\[data-tone="info"\][^}]*\}/)?.[0] ?? "").not.toMatch(/#[0-9a-f]{3,6}|rgb\(|danger/i);
  });
  test("on a phone five rungs read 2 + 2 + 1: the last, odd rung spans both columns", () => {
    expect(css).toMatch(/\.risk__rung:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
  });
});
