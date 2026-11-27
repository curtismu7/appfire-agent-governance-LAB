// The lab's Story glue: the host (run events, the pick+Run press), the script turned into engine steps, and the live fact lines.
import { describe, test, expect, vi } from "vitest";
import { createHost, buildSteps, NOT_YET } from "./storyWiring.js";
import { STEPS } from "./storyScript.js";
import { parseCaptions } from "../../server/src/story/captions.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const captions = parseCaptions(readFileSync('../video/captions.md', 'utf8'));

function fire(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }

describe("host: runs", () => {
  test("waitForRun resolves when a run ends after the mark; a run that ended before the mark does not count", async () => {
    const host = createHost({});
    const m = host.mark();
    const p = host.waitForRun(m, 500);
    fire("appfire:run-start"); fire("appfire:run-end", { ok: true });
    await expect(p).resolves.toEqual({ ok: true });
    const m2 = host.mark();
    fire("appfire:run-end", { ok: true });
    const p2 = host.waitForRun(m2, 300);
    fire("appfire:run-start"); fire("appfire:run-end", { ok: true });
    await expect(p2).resolves.toEqual({ ok: true });
    host.dispose();
  });

  test("a run that finished between the mark and the wait resolves at once; a failed request is not ok; a run that never ends times out", async () => {
    const host = createHost({});
    const m = host.mark(); fire("appfire:run-end", { ok: true });
    await expect(host.waitForRun(m, 500)).resolves.toEqual({ ok: true });
    const m2 = host.mark(); fire("appfire:run-start"); fire("appfire:run-end", { ok: false });
    await expect(host.waitForRun(m2, 500)).resolves.toEqual({ ok: false, reason: expect.stringMatching(/failed/i) });
    const m3 = host.mark();
    await expect(host.waitForRun(m3, 80)).resolves.toEqual({ ok: false, reason: expect.stringMatching(/did not finish/i) });
    host.dispose();
  });

  test("the host says when a run is in flight and tells subscribers as runs start and end", () => {
    const host = createHost({});
    const seen = vi.fn();
    const off = host.onRun(seen);
    fire("appfire:run-start"); expect(host.runInFlight()).toBe(true);
    fire("appfire:run-end", { ok: true }); expect(host.runInFlight()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2); off(); fire("appfire:run-start"); expect(seen).toHaveBeenCalledTimes(2);
    host.dispose();
  });

  test("after dispose the host no longer counts runs", () => {
    const host = createHost({}); host.dispose();
    const m = host.mark(); fire("appfire:run-start"); expect(host.runStarted(m)).toBe(false);
  });
});

describe("host: the page", () => {
  test("send presses the page's own controls with script-made events (the chip runs the use case)", () => {
    document.body.innerHTML = '<button data-testid="wtt-UC1">show my trips</button>';
    const host = createHost({});
    const clicks = vi.fn((e) => { expect(e.isTrusted).toBe(false); });
    document.querySelector('[data-testid=wtt-UC1]').addEventListener("click", clicks);
    host.send({ prompt: { press: ["[data-testid=wtt-UC1]"] } });
    expect(clicks).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test("send throws when a control is busy or missing (Play stops with a message)", () => {
    document.body.innerHTML = '<button data-testid="wtt-UC1" disabled>…</button>';
    const host = createHost({});
    expect(() => host.send({ prompt: { press: ["[data-testid=wtt-UC1]"] } })).toThrow(/not available/);
    host.dispose();
  });

  test("no screenshot is ever offered: slides are text-only", () => { expect(createHost({}).assetUrl("x.jpg")).toBeNull(); });
});

describe("buildSteps", () => {
  const host = createHost({});
  const page = () => {
    // The page as it is after a run settled (the panel the wiring reads).
    document.body.innerHTML = `
      <details data-testid="uc-panel" open><summary>UC1</summary>
        <button data-testid="run">Run</button></details>
      <section data-testid="run-observability">
        <p data-testid="ro-summary">16 allowed, 0 refused, 0 blocked, 5 for information (information is not a pass). Window 2026-11-25T10:00:00Z to 2026-11-25T10:00:00Z.</p>
        <section data-testid="ro-chain"><h3>The chain for this run</h3></section>
        <details data-testid="ro-streams" open><summary>Where these logs live and where they stream</summary></details>
      </section>`;
  };

  test("every step of the script is built (nothing held back)", () => {
    page();
    const steps = buildSteps({ captions, host });
    expect(steps.map((s) => s.key)).toEqual(STEPS.map((s) => s.key));
    expect(NOT_YET).toEqual([]);
  });

  test("targets: the panel, its summary, the chain, the streams section; skipped when the panel is empty", () => {
    page();
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    expect(by.hero_run_prompt.target).toBe("[data-testid=wtt-UC1]");
    expect(by.hero_panel.target()).toBe(document.querySelector("[data-testid=run-observability]"));
    expect(by.hero_summary.target()).toBe(document.querySelector("[data-testid=ro-summary]"));
    expect(by.hero_chain.target()).toBe(document.querySelector("[data-testid=ro-chain]"));
    expect(by.hero_streams.target()).toBe(document.querySelector("[data-testid=ro-streams]"));
    expect(by.hero_streams.target().open).toBe(true); // the streams drawer opened so the bubble can sit beside it
    // the live fact line: the count clause only, never the window
    expect(by.hero_summary.lines()).toEqual(["16 allowed, 0 refused, 0 blocked, 5 for information (information is not a pass)."]);
  });

  test("a bubble that claims something the page does not show is skipped: an empty or missing panel", () => {
    page();
    const by = Object.fromEntries(buildSteps({ captions, host }).map((s) => [s.key, s]));
    document.querySelector("[data-testid=run-observability]").innerHTML = '<p data-testid="ro-empty">Run the demo</p>';
    expect(by.hero_summary.target()).toBeNull();
    expect(by.hero_chain.target()).toBeNull();
    document.querySelector("[data-testid=run-observability]").remove();
    expect(by.hero_panel.target()).toBeNull();
    expect(by.turn_compare.target()).toBeNull();
  });

  test("every step names a known trigger and type, and the wording keys are unique", () => {
    const keys = STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of STEPS) {
      expect(["load", "run-done", "frame"]).toContain(s.trigger);
      expect(["bubble", "slide"]).toContain(s.type);
    }
  });
});
