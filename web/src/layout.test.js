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

// The run record's six-column table is cramped in the 524px evidence column at 1280px (the vendored panel switches to cards only at 760px of viewport
// width). The lab's own container query makes the section a size container and switches it to the card layout when the section is 900px or narrower.
describe("the run record in a narrow column", () => {
  test("the section is a size container, so the card layout follows its own width", () => {
    expect(css).toMatch(/\[data-testid="run-record"\] \{[^}]*container-type: inline-size;/);
  });
  test("below 900px of section width the table becomes cards, and the outcome chip is not forced onto the next cell", () => {
    const q = css.match(/@container \(max-width: 900px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(q).toMatch(/\.ro-table, \.ro-table tbody, \.ro-table tr, \.ro-table td \{ display: block; width: 100%; \}/);
    expect(q).toMatch(/\.ro-row td::before \{/);
  });
});
