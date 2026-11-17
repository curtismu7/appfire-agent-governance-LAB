// The side-by-side comparisons the Compare page offers: two runs of the same lab, with the facts that differ called out.
// Each side names a use case and (when it matters) the persona; nothing here decides anything, it only says what to run.
// The words are vertical-neutral and may carry {{castAction}}-style tokens; `presetFor` fills them from the vertical on screen (see demoGuide.js `fillGuide`).
import { fillGuide } from "./demoGuide";

// Optional fields (airline pack): `onlyFor: "fare"` shows a pair only when the cast has `castFareRule`; `hideFor: "fare"` hides it then; `fare: { why }` is the
// words that replace `why` there. The other packs see exactly the pairs they always saw.
export const PRESETS = [
  {
    id: "allowed-denied", title: "Allowed vs denied",
    why: "Same person, same agent. A read is allowed; a third-party MCP call outside what policy allows is refused at the gateway.",
    sides: [{ uc: "UC1", label: "a low-risk read" }, { uc: "UC31", label: "third-party MCP, out of scope" }],
  },
  {
    id: "same-fare", title: "Same fare, domestic vs international", onlyFor: "fare",
    why: "Same traveller, same agent, same $380 business ask. Denver is domestic and under {{castFareLimit}}: allowed as asked. Toronto is international: the booking goes through, but only in economy. The flag, not the price, made the difference.",
    sides: [{ uc: "UC7", label: "Denver, domestic" }, { uc: "UC8", label: "Toronto, international" }],
  },
  {
    id: "two-fares", title: "Same ask, two fares", onlyFor: "fare",
    why: "Both are domestic business bookings. $380 is at or under {{castFareLimit}}: allowed as asked. $780 is over it: booked, but only in economy.",
    sides: [{ uc: "UC7", label: "$380 to Denver" }, { uc: "UC48", label: "$780 to Boston" }],
  },
  {
    id: "stepup-person", title: "Second factor vs a person", hideFor: "fare",
    why: "Both are writes the agent may not just run: one asks for a second factor, the other for a person to approve.",
    sides: [{ uc: "UC7", label: "a {{castAction}} held for a second factor" }, { uc: "UC8", label: "a {{castAction}} held for a person" }],
  },
  {
    id: "person-tier", title: "Same tool, different person",
    why: "The same sensitive tool for a premium and a standard customer: the decision changes with who asks.",
    fare: { why: "The same sensitive tool for a premium and a standard {{castPerson}}: the decision changes with who asks.", sides: ["premium {{castPerson}}", "standard {{castPerson}}"] },
    sides: [{ uc: "UC21", persona: "premium", label: "premium customer" }, { uc: "UC21", persona: "standard", label: "standard customer" }],
  },
  {
    id: "ask-refuse", title: "Asked first vs refused", hideFor: "fare",
    why: "A {{castAction}} above the first threshold is held for a second factor; one above the limit is refused outright.",
    sides: [{ uc: "UC7", label: "a {{castAction}} held for a second factor" }, { uc: "UC6", label: "a {{castAction}} over the limit" }],
  },
  {
    id: "careful-poisoned", title: "Careful vs poisoned instructions",
    why: "{{castUser}} asks for a low-risk read both times. Poisoned instructions make the agent propose a much larger {{castAction}} instead; Agent Authorize refuses it. The decision comes from the call, never from the prompt.",
    fare: { why: "{{castUser}} asks for a low-risk read both times. Poisoned instructions make the agent propose a $2,500 business booking instead. That is over {{castFareHold}}, so a person must approve it. The decision comes from the call, never from the prompt." },
    sides: [{ uc: "UC1", label: "default instructions" }, { uc: "UC1", instructionsPreset: "poisoned", label: "poisoned instructions" }],
  },
];

// Which pairs a vertical shows (its cast says whether the fare rule is on).
export const presetsFor = (cast) => PRESETS.filter((p) => (cast?.castFareRule ? !p.hideFor : !p.onlyFor));

// A preset with its words filled for the vertical on screen. ctx = { cast, prompts }.
export const presetFor = ({ fare, ...p }, ctx) => {
  const on = Boolean(ctx?.cast?.castFareRule && fare);
  return { ...p, title: fillGuide(p.title, ctx), why: fillGuide(on && fare.why ? fare.why : p.why, ctx), sides: p.sides.map((s, i) => ({ ...s, label: fillGuide(on && fare.sides?.[i] ? fare.sides[i] : s.label, ctx) })) };
};
