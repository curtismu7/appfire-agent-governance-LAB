// Today's demo: the eight cases of the Larkspur Air demo (demoCases.js) are the only use cases the page offers until the presenter switches to "All use cases".
// Nothing is removed: the whole catalog, every prompt and every pair stay in the lab and come back with one click. This file only decides what is hidden while
// the set is "demo". Chat matching and the fill-in words keep the full lists, so a typed prompt outside the eight still runs.
import { DEMO_CASES, casesFor } from "./demoCases";
import { PRESETS } from "./compare";

export const SET_KEY = "aag.set";

// The use case ids of the eight, or null when this vertical has no eight (only the airline pack does).
export const demoUcIds = (cast) => (casesFor(cast) ? new Set(DEMO_CASES.map((c) => c.uc).filter(Boolean)) : null);

// Compare pairs that stay: any pair a case points at, and any pair whose every side is one of the eight.
export function demoPresetIds(cast) {
  const ids = demoUcIds(cast);
  if (!ids) return null;
  const named = new Set(DEMO_CASES.flatMap((c) => [c.compare, ...(c.links || []).map((l) => l.kind === "compare" ? l.preset : null)]).filter(Boolean));
  return new Set(PRESETS.filter((p) => named.has(p.id) || p.sides.every((s) => ids.has(s.uc))).map((p) => p.id));
}

// The Run buttons of a walkthrough step: a run stays when its use case is one of the eight, a Compare button when its pair stays.
export const keepButtons = (buttons, cast) => {
  const ids = demoUcIds(cast), pairs = demoPresetIds(cast);
  return ids ? buttons.filter((b) => (b.compare ? pairs.has(b.compare) : ids.has(b.uc))) : buttons;
};

// `choice` is "demo" or "all"; a vertical with no eight always shows everything.
export const activeSet = (cast, choice) => (choice === "demo" && demoUcIds(cast) ? demoUcIds(cast) : null);
export const promptsInSet = (prompts, ids) => (ids ? prompts.filter((p) => ids.has(p.uc)) : prompts);
export const savedSet = () => { try { return window.localStorage.getItem(SET_KEY) === "all" ? "all" : "demo"; } catch { return "demo"; } };
