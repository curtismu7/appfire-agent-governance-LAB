// Which use cases run Real (owner, 2026-11-10; widened 2026-11-16). A use case runs Real only when the tool it calls (resolved for the vertical) is
// served through the SE Agent Gateway, and when nothing in it needs a part this lab keeps simulated. Everything else runs on the labelled mock engine
// in Real mode (owner 2026-11-16, reversing the 2026-11-13 refusal), and its hops say MOCK and why.
//
// SE_MCP_TOOLS: tool NAMES only, read once from AI-DEMO2's oauth-mcp source (src/tools/BankingToolRegistry.ts and
// src/tools/handlers/verticalTools.generated.ts at origin/main, 2026-11-10), limited to the tools the use cases here can call. 2026-11-16: the
// owner scaled api-resource-server up on SE (show_mortgage), and the third-party tool servers (mcp-weather, mcp-brave, mcp-code-search) are
// running there, so show_mortgage, get_weather, brave_news_search and code_search are listed too. Whether the gateway routes the third-party ones
// to this lab's token is UNVERIFIED: the gateway's own tools/list is checked at run time, and a tool it does not list is never called (the run
// ends REAL_NOT_LISTED and says so). Tools that need a service still scaled to 0 on SE (agent-service) are NOT in the list; their reason is in
// TOOL_NEEDS.
import { isFlow, chainOf } from './flow.js';
import { toolFor } from './cast.js';

export const SE_MCP_TOOLS = new Set([
  'get_my_accounts', 'get_account_balance', 'create_transfer', 'get_sensitive_account_details', 'get_branch_hours', 'request_fee_waiver',
  'redeem_miles', 'book_airline_flight', 'view_coverage', 'pay_bill', 'sensitive_patient_records', 'list_orders', 'checkout', 'sensitive_order_history',
  'show_mortgage', 'get_weather', 'brave_news_search', 'code_search',
]);
export const TOOL_NEEDS = {
  get_portfolio_summary: 'the A2A agent-service, which is scaled to 0 on SE',
};
// Trusted-caller features: they need headers a caller must never send (forced actor, rate-limit toggle, TraT, tiers).
const TRUSTED_FEATURE = { UC13: 'the forced actor', UC18: 'the rate-limit toggle', UC21: 'the entitlement tiers' };
const A2A = /^a2a-|^verified-trust-issuance$/;
const PRIVILEGE_LANE = /^(privilege-gateway-leg|credential-swap|enterprise-managed-mode|id-jag-)/;
const APPROVAL = new Set(['ciba-poll', 'ciba-authorize', 'hitl-receipt']);

// { real: true, tool } or { real: false, reason } (fixed words; the reason names the part that keeps it Mock).
export function realGate(uc, cast) {
  if (!isFlow(uc)) return { real: false, reason: 'it is a guided page: the lab shows it and does not compute it' };
  const chain = chainOf(uc);
  // Owner 2026-11-13: UC7/UC8 (the hitl track, tool create_transfer) run REAL — the SE gateway's HITL pipeline
  // (428 + challenge, the HITL service, the receipt retry) is live and this lab drives it with the mock phone.
  // The other approval kinds stay simulated: CIBA needs an out-of-band device flow, elicitation an interactive answer.
  if (uc.track === 'hitl' && !['UC7', 'UC8'].includes(uc.id)) return { real: false, reason: 'its human approval (CIBA or elicitation) is simulated in this lab' };
  if (uc.track !== 'hitl' && chain.some((k) => APPROVAL.has(k))) return { real: false, reason: 'its human approval (CIBA or elicitation) is simulated in this lab' };
  if (Object.hasOwn(TRUSTED_FEATURE, uc.id)) return { real: false, reason: `${TRUSTED_FEATURE[uc.id]} is a trusted-caller feature, and this lab never sends trusted-caller headers` };
  if (/\btrat\b|transaction token/i.test(`${uc.title} ${uc.pingOneSolution}`)) return { real: false, reason: 'transaction tokens (TraT) are a trusted-caller feature, and this lab never sends trusted-caller headers' };
  if (chain.some((k) => A2A.test(k)) || uc.primaryTool === 'get_portfolio_summary') return { real: false, reason: 'agent-to-agent (A2A) multi-hop runs on the agent-service, which is scaled to 0 on SE' };
  if (chain.some((k) => PRIVILEGE_LANE.test(k)) || (uc.needs || []).includes('privilege')) return { real: false, reason: 'the Privilege, PingFederate and ID-JAG lanes are not part of this Real path' };
  if (chain.includes('personal-agent-lookup')) return { real: false, reason: 'the personal-agent lane is not part of this Real path' };
  if (chain.some((k) => k.startsWith('sim-'))) return { real: false, reason: 'it stages an attack, which only the mock engine can stage' };
  if (uc.flag) return { real: false, reason: `it needs the AI-DEMO2 feature flag ${uc.flag}, which is not known to be on in SE` };
  if (!uc.primaryTool) return { real: false, reason: 'it calls no tool, so there is nothing for the SE MCP server to run' };
  const tool = toolFor(cast, uc.primaryTool);
  if (Object.hasOwn(TOOL_NEEDS, tool)) return { real: false, reason: `its tool ${tool} needs ${TOOL_NEEDS[tool]}` };
  if (!SE_MCP_TOOLS.has(tool)) return { real: false, reason: `its tool ${tool} is not served by the SE mcp-server` };
  return { real: true, tool };
}

// The arguments the lab sends for each tool (lab-invented, labelled). Account ids come from get_my_accounts in the same session (the user's own).
export const NEEDS_ACCOUNTS = new Set(['get_account_balance', 'create_transfer', 'request_fee_waiver']);
export function toolArgs(tool, { vertical, accounts = [], amount, args }) {
  const a0 = accounts[0] ?? null; const a1 = accounts[1] ?? accounts[0] ?? null;
  const amt = Number.isFinite(amount) ? amount : 25;
  switch (tool) {
    case 'get_account_balance': return { account_id: a0 };
    case 'create_transfer': return { from_account_id: a0, to_account_id: a1, amount: amt, description: 'Customer Agent LAB (Real)' };
    case 'request_fee_waiver': return { account_id: a0, reason: 'Customer request' };
    case 'get_branch_hours': return { vertical };
    case 'pay_bill': case 'checkout': return { amount: amt };
    // The third-party tools take what the use case stages (situations.js args: a state, a search query). Parameter names are UNVERIFIED against SE.
    case 'get_weather': return { state: typeof args?.state === 'string' ? args.state : 'TX' };
    case 'brave_news_search': case 'code_search': return { query: typeof args?.query === 'string' ? args.query : 'status' };
    default: return {};
  }
}
