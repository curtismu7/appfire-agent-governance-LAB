// The lab's INPUTS for each use case that the engine computes (lab-invented, lab-derived from the catalog text). The catalog says what a use case
// shows (title, trigger, solution); it does not carry numbers. These are the numbers and events the lab feeds the engine so the policy rules in
// policy.js produce the outcome. The expected outcome is NOT in this table: it comes from the manifest, and a test compares the engine's computed
// outcome with it for all 87.
//   persona   standard | premium (default standard)
//   amount    the money value of the call, where the tool moves money (thresholds are lab-invented; see policy.js)
//   args      tool arguments the gateway edge policy reads (state, query)
//   event     the hostile or special event the run stages (see flow.js)
//   groupGate the sensitive tool is gated on a group (UC9 vs UC21)
//   rar       pushed authorization_details bound (maxAmount)
//   forgedApproval the client sends a boolean approval flag instead of a verified receipt
//   public    a public catalog call that needs no token
//   trip, international, phoneApproval   airline pack only (SITUATION_OVERRIDES.airline): the staged flight, the international flag and a lab input that
//             approves a booking change on the traveller's own phone. They are dedicated fields, NOT `args`: `args` would run the gateway edge policy
//             and turn a read into a write.
//   chain     a lab-derived chain for use cases whose catalog evidence chain is empty
export const SITUATIONS = {
  UC6: { amount: 2500 },
  UC7: { amount: 600 },
  UC8: { amount: 300 },
  UC22: { amount: 150 },
  UC27: { amount: 600, forgedApproval: true },
  UC48: { amount: 850 },
  UC9: { persona: 'standard', groupGate: true },
  UC21: { persona: 'premium', groupGate: true },
  UC5: { event: 'insufficient-scope' },
  UC10: { event: 'cross-owner-account' },
  UC11: { event: 'wrong-aud' },
  UC12: { event: 'dpop-replay' },
  UC13: { event: 'rogue-actor' },
  UC14: { event: 'rar-exceeded', amount: 900, rar: { maxAmount: 500 } },
  UC14b: { amount: 400, rar: { maxAmount: 500 } },
  UC15: { event: 'tampered-intent-token' },
  UC16: { event: 'impersonation-no-act' },
  UC16b: { event: 'raw-user-token-forwarding' },
  UC18: { event: 'rate-limit-burst', burst: 40 },
  UC29: { event: 'introspection-down' },
  UC24: { public: true },
  UC30: { args: { state: 'TX' } },
  UC31: { args: { state: 'FL' } },
  UC41: { args: { query: 'regional weather outlook' } },
  UC42: { args: { query: 'bitcoin price today' } },
  UC2: { persona: 'standard' },
  'UC-LOGIN': { chain: ['user-token'] },
  'UC-LOGIN-PF': { chain: ['user-token'] },
  'UC-LOGIN-AIC': { chain: ['user-token'] },
  'UC-AIC-TX': { chain: ['user-token', 'token-exchange'] },
  'UC-OBO': { chain: ['user-token', 'token-exchange'] },
};
// Where a vertical's third-party tools take other arguments (the software pack's scanner takes a repository, its web search a Jira question), the
// override replaces the use case's `args`. Everything else about the use case is shared. Banking, healthcare and retail have no override.
// The airline pack's staged bookings (LAB-INVENTED flights and fares; the README lists them). One listed fare per flight: the price of the business seat
// the lab asks for. `international` is the flag the fare rule reads.
const trip = (flight, to, city, day) => ({ flight, from: 'ORD', to, city, day, cabin: 'business' });
export const SITUATION_OVERRIDES = {
  airline: {
    UC7: { amount: 380, trip: trip('LK 214', 'DEN', 'Denver', 'Friday') },
    UC8: { amount: 380, international: true, trip: trip('LK 322', 'YYZ', 'Toronto', 'Friday') },
    UC48: { amount: 780, trip: trip('LK 560', 'BOS', 'Boston', 'December 4') },
    UC6: { amount: 2400, international: true, trip: trip('LK 704', 'CDG', 'Paris', 'November 28') },
    UC27: { amount: 2400, international: true, forgedApproval: true, trip: trip('LK 704', 'CDG', 'Paris', 'November 28') },
    UC22: { amount: 150, phoneApproval: true, trip: trip('LK 109', 'DEN', 'Denver', 'Friday') },
    UC14b: { trip: trip('LK 330', 'SFO', 'San Francisco', 'Friday') }, // amount 400 comes from the shared situation: exactly the first limit, flight LK 330
  },
  software: {
    UC30: { args: { repo: 'platform' } },
    UC31: { args: { repo: 'payroll' } },
    UC41: { args: { query: 'Jira workflow automation best practices' } },
    UC42: { args: { query: 'crypto-mining script in our build' } },
  },
};
export const situationOf = (id, vertical) => {
  const base = Object.hasOwn(SITUATIONS, id) ? SITUATIONS[id] : {};
  const over = Object.hasOwn(SITUATION_OVERRIDES, vertical) && Object.hasOwn(SITUATION_OVERRIDES[vertical], id) ? SITUATION_OVERRIDES[vertical][id] : null;
  return over ? { ...base, ...over } : base;
};
