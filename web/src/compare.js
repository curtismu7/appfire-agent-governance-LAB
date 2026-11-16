// The side-by-side comparisons the Compare page offers: two runs of the same lab, in Mock, with the facts that differ called out.
// Each side names a use case and (when it matters) the persona; nothing here decides anything, it only says what to run.
// The words are vertical-neutral and may carry {{castAction}}-style tokens; `presetFor` fills them from the vertical on screen (see demoGuide.js `fillGuide`).
import { fillGuide } from "./demoGuide";

export const PRESETS = [
  {
    id: "allowed-denied", title: "Allowed vs denied",
    why: "Same person, same agent. A read is allowed; a third-party MCP call outside what policy allows is refused at the gateway.",
    sides: [{ uc: "UC1", label: "a low-risk read" }, { uc: "UC31", label: "third-party MCP, out of scope" }],
  },
  {
    id: "stepup-person", title: "Second factor vs a person",
    why: "Both are writes the agent may not just run: one asks for a second factor, the other for a person to approve.",
    sides: [{ uc: "UC7", label: "a {{castAction}} held for a second factor" }, { uc: "UC8", label: "a {{castAction}} held for a person" }],
  },
  {
    id: "person-tier", title: "Same tool, different person",
    why: "The same sensitive tool for a premium and a standard customer: the decision changes with who asks.",
    sides: [{ uc: "UC21", persona: "premium", label: "premium customer" }, { uc: "UC21", persona: "standard", label: "standard customer" }],
  },
  {
    id: "ask-refuse", title: "Asked first vs refused",
    why: "A {{castAction}} above the first threshold is held for a second factor; one above the limit is refused outright.",
    sides: [{ uc: "UC7", label: "a {{castAction}} held for a second factor" }, { uc: "UC6", label: "a {{castAction}} over the limit" }],
  },
  {
    id: "careful-poisoned", title: "Careful vs poisoned instructions",
    why: "{{castUser}} asks for a low-risk read both times. Poisoned instructions make the simulated agent propose a much larger {{castAction}} instead (lab-simulated obedience); Agent Authorize refuses it. The decision comes from the call, never from the prompt.",
    sides: [{ uc: "UC1", label: "default instructions" }, { uc: "UC1", instructionsPreset: "poisoned", label: "poisoned instructions" }],
  },
];

// A preset with its words filled for the vertical on screen. ctx = { cast, prompts }.
export const presetFor = (p, ctx) => ({ ...p, title: fillGuide(p.title, ctx), why: fillGuide(p.why, ctx), sides: p.sides.map((s) => ({ ...s, label: fillGuide(s.label, ctx) })) });
