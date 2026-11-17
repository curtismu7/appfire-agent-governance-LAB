// What the agent says after a MOCK tool call (data/replies.json): a real-sounding sentence per vertical and tool, with LAB-INVENTED values that are
// fixed per vertical and persona (a run repeats exactly). Pure: no clock, no random, no I/O beyond the import. Refusals are not here: their text
// comes from the run's own refusal hop.
import { fill } from './cast.js';
import { countText, unitFor } from './policy.js';
import REPLIES from '../../data/replies.json' with { type: 'json' };

export { REPLIES };
const own = (o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
export const money = (n) => `$${Number(n).toLocaleString('en-US', Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The values one template is filled with: the cast, the defaults, the vertical's values (persona over common), the tool arguments and the amount.
// Airline pack only (optional input fields): `booking` is the staged trip (flight, from, city, day, conf: strings merged in like the tool arguments) and
// `constrained` is { because: [...] } when the fare rule narrowed the call; `why` then reads from constrained.<vertical>.reasons.
export function valuesFor(input) {
  const { cast, vertical, persona, amount, args, booking, constrained } = input;
  const v = own(REPLIES.values, vertical) || {};
  const base = { ...cast, ...REPLIES.defaults, ...(v.common || {}), ...(own(v, persona) || {}) };
  for (const [k, x] of Object.entries(args || {})) if (typeof x === 'string' || typeof x === 'number') base[k] = String(x);
  for (const [k, x] of Object.entries(booking || {})) if (typeof x === 'string' || typeof x === 'number') base[k] = String(x);
  const n = typeof amount === 'number' ? amount : base.defaultAmount;
  // A pack whose amount is a count (software: issues) names its unit; every other pack prints dollars.
  const unit = unitFor(cast, input.tool);
  base.amount = typeof n === 'number' ? (unit ? countText(n, unit) : money(n)) : 'the amount';
  const reasons = own(own(own(REPLIES, 'constrained'), vertical), 'reasons');
  if (constrained && Array.isArray(constrained.because) && reasons) base.why = fill(own(reasons, constrained.because.join('+')) ?? '', base);
  return base;
}

// A call the fare rule narrowed takes the pack's `constrained` sentence first; every other call (and every other pack) takes the unchanged path.
export const templateFor = (vertical, tool, constrained) => (constrained ? own(own(own(REPLIES, 'constrained'), vertical), tool) : undefined) ?? own(own(REPLIES.replies, vertical), tool) ?? own(REPLIES.replies.shared, tool) ?? null;

// A pack's own sentence for one use case (airline pack only: `byUseCase`), read when the input names the use case (`uc`). Null for every other call.
const ucTemplate = (input) => (typeof input.uc === 'string' ? own(own(own(REPLIES, 'byUseCase'), input.vertical), input.uc) ?? null : null);
export const ucReplyFor = (input) => { const t = ucTemplate(input); return t ? fill(t, valuesFor(input)) : null; };

// The agent's sentence for a finished tool call. Unknown tools get the generic fallback, never the tool's name dressed up as a result.
export function replyFor(input) {
  const t = ucTemplate(input) ?? templateFor(input.vertical, input.tool, input.constrained) ?? REPLIES.fallback;
  return fill(t, valuesFor(input));
}

// What the agent says when the write is held for an approval (step-up or a person): it names what it is ready to do, nothing more.
export function proposalFor(input) {
  const t = own(own(REPLIES.proposals, input.vertical), input.tool) ?? REPLIES.proposalFallback;
  return fill(t, valuesFor(input));
}

export const PROBE_DENIED = REPLIES.probeDenied;
