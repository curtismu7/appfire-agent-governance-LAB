// The lab's authorization rules. Pure functions, no I/O. Every threshold here is LAB-INVENTED: it is fitted to the amounts the catalog's chips use
// (150, 300, 600, 2500) and is not Ping's policy.
//   money tools:   amount >= 2000 DENY, >= 500 STEP_UP, >= 200 HITL_REQUIRED, >= 100 CIBA (approved out of band), below that PERMIT
//   booking tools: amount >= 250 HITL_REQUIRED
//   airline pack (castFareRule): see fareDecision below; the two limits and the international flag are LAB-INVENTED
// The decision is made from the request context, not read from the manifest.
export const BANDS = {
  money: [{ min: 2000, decision: 'DENY' }, { min: 500, decision: 'STEP_UP' }, { min: 200, decision: 'HITL_REQUIRED' }, { min: 100, decision: 'CIBA' }],
  booking: [{ min: 250, decision: 'HITL_REQUIRED' }],
};
// The airline pack's fare rule (LAB-INVENTED): a domestic booking up to `limit` is allowed as asked; an international booking, or one over `limit` and up
// to `hold`, is booked but the cabin is narrowed from `from` to `to`; over `hold` a person approves. A fare of exactly `limit` is allowed; exactly `hold` is narrowed.
export const FARE_RULE = Object.freeze({ limit: 400, hold: 1500, from: 'business', to: 'economy' });
export const BOOKING_TOOLS = new Set(['book_airline_flight']);
export const bandsFor = (tool, role) => (BOOKING_TOOLS.has(tool) ? BANDS.booking : role === 'write' ? BANDS.money : null);

export const GATEWAY = { audience: 'gateway', rateLimit: 30, allowedState: 'TX', blockedTerms: ['bitcoin', 'crypto'] };
// The third-party code scanner the software pack may use (LAB-INVENTED): the repositories its gateway entry is configured for. The software pack's
// scan tool takes the place of the weather tool's state rule; every other vertical keeps the state rule.
export const SCANNER_REPOS = ['platform', 'billing', 'mobile'];
export const SCAN_VERTICALS = new Set(['software']);

// How a count prints. A vertical whose amount is a count (the software pack: issues in a bulk edit) names its unit in the cast (castUnit); every other
// pack prints the bare number (policy text) or dollars (replies). A booking tool's amount is money in every pack.
export const unitFor = (cast, tool) => (cast && typeof cast.castUnit === 'string' && cast.castUnit && !BOOKING_TOOLS.has(tool) ? cast.castUnit : null);
export const countText = (n, unit) => (unit ? `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}` : String(n));

// PDP decision. ctx: { role, tool, amount, unit, owner, sub, groupGate, groups, group, actor: { registered }, rar, event }
// Airline pack only (optional): fareRule (bool), international (bool), cabin (string), forgedApproval (bool), phoneApproval (bool). Every other call is unchanged.
// `unit` (optional, from unitFor) only changes how the amount reads in the reason: "600 issues is in the STEP_UP band" instead of "amount 600 is ...".
// Returns { decision: PERMIT|DENY|DENY_403|STEP_UP|HITL_REQUIRED|CIBA|CONSTRAINED, reason }; CONSTRAINED (the fare rule only) also carries
// `constrain: { field, asked, granted, because, limit }`: the call is allowed with one argument narrowed.
export function decide(ctx) {
  if (ctx.actor && ctx.actor.registered === false) return { decision: 'DENY', reason: 'the acting agent in the act chain is not a registered agent' };
  if (ctx.owner && ctx.sub && ctx.owner !== ctx.sub) return { decision: 'DENY', reason: 'the resource belongs to another customer; the token subject does not own it' };
  if (ctx.rar && typeof ctx.amount === 'number' && ctx.amount > ctx.rar.maxAmount) return { decision: 'DENY', reason: 'the call exceeds the pushed authorization_details bound' };
  if (ctx.groupGate && !ctx.groups.includes(ctx.group)) return { decision: 'DENY_403', reason: 'group policy: the user is not a member of the required group' };
  if (ctx.fareRule && (ctx.role === 'write' || BOOKING_TOOLS.has(ctx.tool)) && typeof ctx.amount === 'number') return fareDecision(ctx);
  const bands = bandsFor(ctx.tool, ctx.role);
  if (bands && typeof ctx.amount === 'number') {
    const hit = bands.find((b) => ctx.amount >= b.min);
    if (hit) return { decision: hit.decision, reason: `${ctx.unit ? countText(ctx.amount, ctx.unit) : `amount ${ctx.amount}`} is in the ${hit.decision} band (lab-invented threshold ${hit.min})` };
  }
  return { decision: 'PERMIT', reason: 'no rule restricts this call' };
}

const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;
// Order matters: a claimed approval over the second limit, then the second limit, then the phone, then the narrowing, then permit.
// A claim never LOWERS the control: over the second limit the booking needed a person anyway, so the second factor comes first and a person still approves.
// At or under the second limit a claim changes nothing and is ignored.
function fareDecision(ctx) {
  const { limit, hold, from, to } = FARE_RULE;
  const n = ctx.amount; const fare = usd(n);
  if (ctx.forgedApproval && n > hold) return { decision: 'STEP_UP', reason: `the request claims an approval but carries no verified approval receipt; a claim is not an approval, so a second factor is required first, and ${fare} is over the ${usd(hold)} limit, so a person must still approve it (lab-invented rule)` };
  // The second limit comes before the phone: a lab input must never let a booking over it through with no person (a poisoned run steered to $2,500 on the phone use case still waits).
  if (n > hold) return { decision: 'HITL_REQUIRED', reason: `${fare} is over the ${usd(hold)} limit, so a person must approve it (lab-invented limit)` };
  if (ctx.phoneApproval) return { decision: 'CIBA', reason: "this booking change is approved on the traveller's own phone (a lab input: the fare rule itself has no phone step)" };
  const intl = ctx.international === true; const over = n > limit;
  if ((intl || over) && (ctx.cabin ?? from) === from) {
    const because = [...(intl ? ['international'] : []), ...(over ? ['over-limit'] : [])];
    const why = intl && over ? `the trip is international and ${fare} is over the ${usd(limit)} limit`
      : intl ? `the trip is international (the flag alone narrows it; ${fare} is not over the ${usd(limit)} limit)`
        : `${fare} is over the ${usd(limit)} limit and not over ${usd(hold)}`;
    return { decision: 'CONSTRAINED', reason: `${why}, so ${from} is narrowed to ${to} (lab-invented limits)`, constrain: { field: 'cabin', asked: from, granted: to, because, limit } };
  }
  // Either nothing trips a gate, or a gate trips but the cabin asked is already the narrowest seat: never a CONSTRAINED that changes nothing.
  return { decision: 'PERMIT', reason: (intl || over) ? 'economy is already the narrowest seat, so nothing is narrowed (lab-invented rule)' : `a domestic booking of ${fare} is at or under the ${usd(limit)} limit, so it is allowed as asked (lab-invented limit)` };
}

// Gateway edge policy for third-party servers: arguments are read at the edge. Returns null (allowed) or a reason.
export function edgePolicy(tool, args, vertical) {
  if (tool === 'get_weather' && SCAN_VERTICALS.has(vertical)) {
    return SCANNER_REPOS.includes(String(args?.repo || '').toLowerCase()) ? null : `the code scanner is configured for the ${SCANNER_REPOS.join(', ')} repositories only`;
  }
  if (tool === 'get_weather') return args?.state === GATEWAY.allowedState ? null : `the configured state scope is ${GATEWAY.allowedState}`;
  if (tool === 'brave_news_search') {
    const q = String(args?.query || '').toLowerCase();
    const hit = GATEWAY.blockedTerms.find((t) => q.includes(t));
    return hit ? 'the query contains a blocked term' : null;
  }
  return null;
}
