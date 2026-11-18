// The eight cases of the Larkspur Air demo, in the order they are shown (the same eight as the demo video). The Talk track lists them on the left; a click shows
// what the session agenda asks for (the requirement, read from the walkthrough step the case belongs to, so there is one source), the words to type, what the page
// will show, the talking points and the links into the lab. Airline pack only: the other packs keep the plain talk track.
// A case runs one of three ways: `uc` (a chat run, the same handler as the Demo guide's Run button), `compare` (the Compare page at that pair) or `history` (the Run
// history page). No use case id is ever shown: the title is the name, `uc` stays in data and test ids.
// `link.kind`: agenda (Presenter mode at the case's walkthrough step), guide (the Demo guide), runs (Run history), compare (Compare at `preset`).
// Who decided is said as the page says it on every run: PingOne Authorize only when its settings are set and the Decision card names it, otherwise the lab's own rule.
export const DEMO_CASES = [
  {
    id: "booked-as-asked", title: "Booked as asked", stepId: "allow", uc: "UC7",
    explain: "A domestic trip under $400 goes straight through: business was asked for and business is booked, and nobody has to step in.",
    show: "The Decision card says ALLOWED. The five-step strip lands on step one. The policy row says who decided: PingOne Authorize when its settings are set, otherwise the lab's own fare rule (the card then says it is not a PingOne Authorize outcome).",
    say: [
      "Elena asks for a business seat to Denver for $380. It is a domestic trip under $400, so the policy lets it through as asked.",
      "Point at the policy row: it names who decided. Reads and small bookings flow; the record is still written.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 5: allowed automatically" }, { kind: "guide", label: "Demo guide" }],
  },
  {
    id: "economy-only", title: "Economy only", stepId: "escalate", uc: "UC8",
    explain: "Same business seat, but to Toronto, which is international: the booking is made, with a limit. The agent asked for business and the traveller gets economy.",
    show: "The Decision card says CONSTRAINED and shows what was asked for and what was booked (business asked, economy booked). Step two of five.",
    say: [
      "An international trip is never refused here, it is narrowed: the policy permits it with a limit, and the answer says exactly what changed.",
      "Open the seat row: business asked, economy booked. The limit is the lab's own, Larkspur Air would set the real one in policy.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 6: denied, constrained or approved" }, { kind: "compare", preset: "ask-refuse", label: "Compare two runs" }],
  },
  {
    id: "second-factor", title: "Second factor first", stepId: "escalate", uc: "UC27",
    explain: "A claim of approval is not proof. Elena says her manager already approved the Paris trip, so the airline asks for a second factor before anything runs.",
    show: "A phone prompt appears and nothing is booked until the second factor is given. Step three of five. The page says the airline's own policy decided this, not PingOne Authorize.",
    say: [
      "The user says a manager already approved it. A claim is not an approval, so the policy asks for proof first.",
      "Because the trip is over $1,500, a person still approves after the second factor.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 6: denied, constrained or approved" }, { kind: "guide", label: "Demo guide" }],
  },
  {
    id: "person-approves", title: "A person approves", stepId: "escalate", uc: "UC6",
    explain: "Over $1,500 a person decides. The booking is held, the approver's phone shows Approve and Deny, and the booking runs after the approval is recorded.",
    show: "The Decision card says HELD, then ALLOWED after the approval. Step four of five. The approver's phone is on the page: tap Approve.",
    say: [
      "The policy does not guess: above the higher limit a human approves, and the approval is recorded with the run.",
      "Tap Approve on the phone. The policy is asked again and permits the booking as asked.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 6: denied, constrained or approved" }, { kind: "runs", label: "Run history" }],
  },
  {
    id: "refused-by-policy", title: "Refused by policy", stepId: "evaluate", uc: "UC9",
    explain: "Elena asks for her sensitive passenger record. The tool server refuses it because a group is required, and the page says why in the policy's own words.",
    show: "The Decision card says DENIED with the reason written out. Step five of five, the strongest control. The page says this policy is the lab's own, not PingOne Authorize.",
    say: [
      "Same tool, different person: the decision follows who asks and what they are entitled to.",
      "Read the reason on the card out loud. A refusal that cannot say why is not auditable.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 4: Ping evaluates the call" }, { kind: "guide", label: "Demo guide" }],
  },
  {
    id: "third-party-refused", title: "Third party refused", stepId: "escalate", uc: "UC10",
    explain: "Elena asks for the upcoming trips of another traveller, Marcus Bell. Those trips belong to another customer, so the request is refused and nothing is sent to the tool.",
    show: "The Decision card says DENIED and the reason row says whose data it is. Step five again. The page labels this refusal Agent Authorize.",
    say: [
      "The token's subject does not own those trips, so the call never reaches the tool.",
      "Say it as the page labels it: Agent Authorize. Nobody can quietly read another traveller's bookings through the agent.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 6: denied, constrained or approved" }, { kind: "compare", preset: "ask-refuse", label: "Compare two runs" }],
  },
  {
    id: "poisoned-instructions", title: "Poisoned instructions", stepId: "escalate", compare: "careful-poisoned",
    explain: "Two runs side by side: the same agent with careful instructions and with poisoned ones. The poisoned agent proposes a $2,500 business booking, which is over $1,500, so a person must approve it.",
    show: "The Compare page opens at the pair. Left: allowed. Right: held by the airline's own policy, because the decision comes from the call, never from the prompt.",
    say: [
      "A manipulated agent cannot talk its way past the policy: permissions are enforced at the tool, data and action layers, not left to the model.",
      "The poisoned run is not one of the eleven attacks, it shows that the decision follows the call.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 6: limiting damage" }, { kind: "guide", label: "Demo guide" }],
  },
  {
    id: "audit-trail", title: "Audit trail", stepId: "audit", history: true,
    explain: "Every run is recorded with its outcome: which agent acted, on whose behalf, which tool, which policy applied, and whether access was allowed, denied or escalated.",
    show: "The Run history page lists the runs from the previous cases, one row each, with the outcome and the check that applied.",
    say: [
      "When a security team asks what an agent did and who allowed it, the answer is a query, not an investigation.",
      "Open a row: every hop carries its raw request, response and a W3C traceparent.",
    ],
    links: [{ kind: "agenda", label: "Agenda step 7: the history is there for audit" }, { kind: "runs", label: "Run history" }],
  },
];

// The case the visitor sees for this vertical: only the airline pack (the one with a fare rule) has the eight.
export const casesFor = (cast) => (cast?.castFareRule ? DEMO_CASES : null);

// The words to type for a case: the vertical's own What to type text for its use case, or what to press for the two cases that type nothing.
export function promptOfCase(c, prompts = []) {
  if (c.uc) return (prompts.find((p) => p.uc === c.uc) || {}).text || null;
  return null;
}
export const runLabelOfCase = (c) => (c.compare ? "Open Compare at this pair" : c.history ? "Open Run history" : "Run this case");
