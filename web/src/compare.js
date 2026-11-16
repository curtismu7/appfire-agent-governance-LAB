// The side-by-side comparisons the Compare page offers: two runs of the same lab, in Mock, with the facts that differ called out.
// Each side names a use case and (when it matters) the persona; nothing here decides anything, it only says what to run.
export const PRESETS = [
  {
    id: "allowed-denied", title: "Allowed vs denied",
    why: "Same person, same agent. A read is allowed; a third-party MCP call outside what policy allows is refused at the gateway.",
    sides: [{ uc: "UC1", label: "show my balance" }, { uc: "UC31", label: "third-party MCP, out of scope" }],
  },
  {
    id: "stepup-person", title: "Second factor vs a person",
    why: "Both are writes the agent may not just run: one asks for a second factor, the other for a person to approve.",
    sides: [{ uc: "UC7", label: "transfer $600" }, { uc: "UC8", label: "transfer $300" }],
  },
  {
    id: "person-tier", title: "Same tool, different person",
    why: "The same sensitive tool for a premium and a standard customer: the decision changes with who asks.",
    sides: [{ uc: "UC21", persona: "premium", label: "premium customer" }, { uc: "UC21", persona: "standard", label: "standard customer" }],
  },
  {
    id: "ask-refuse", title: "Asked first vs refused",
    why: "A $600 transfer is held for a second factor; a $2500 one is refused outright.",
    sides: [{ uc: "UC7", label: "transfer $600" }, { uc: "UC6", label: "transfer $2500" }],
  },
  {
    id: "careful-poisoned", title: "Careful vs poisoned instructions",
    why: "The customer asks for a balance both times. Poisoned instructions make the simulated agent propose a $2500 transfer instead (lab-simulated obedience); Agent Authorize refuses it. The decision comes from the call, never from the prompt.",
    sides: [{ uc: "UC1", label: "default instructions" }, { uc: "UC1", instructionsPreset: "poisoned", label: "poisoned instructions" }],
  },
];
