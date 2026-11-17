// Which use cases run Real (owner, 2026-11-10; widened 2026-11-16). A use case runs Real only when the tool it calls (resolved for the vertical) is
// served by something that can answer it (the SE Agent Gateway for banking, healthcare and retail; the lab's own tool server, or an SE-hosted instance of
// it, for the software vertical: owner 2026-11-16 reversed "software is mock-only"), and when nothing in it needs a part this lab does not run for real.
// Everything else runs whole on the lab's own steps in Real mode (owner 2026-11-16, reversing the 2026-11-13 refusal), and the data says why.
//
// SE_MCP_TOOLS: tool NAMES only, read once from AI-DEMO2's oauth-mcp source (src/tools/BankingToolRegistry.ts and
// src/tools/handlers/verticalTools.generated.ts at origin/main, 2026-11-10), limited to the tools the use cases here can call. 2026-11-16: the
// owner scaled api-resource-server up on SE (show_mortgage), and the third-party tool servers (mcp-weather, mcp-brave, mcp-code-search) are
// running there, so show_mortgage, get_weather, brave_news_search and code_search are listed too. Whether the gateway routes the third-party ones
// to this lab's token is UNVERIFIED: the gateway's own tools/list is checked at run time, and a tool it does not list is never called (the run
// ends REAL_NOT_LISTED and says so). TOOL_NEEDS holds the reason for a tool that needs a service this lab cannot
// reach (none today).
import { isFlow, chainOf } from './flow.js';
import { toolFor } from './cast.js';
import { LOCAL_TOOLS } from './provider.js';

export const SE_MCP_TOOLS = new Set([
  'get_my_accounts', 'get_account_balance', 'create_transfer', 'get_sensitive_account_details', 'get_branch_hours', 'request_fee_waiver',
  'redeem_miles', 'book_airline_flight', 'view_coverage', 'pay_bill', 'sensitive_patient_records', 'list_orders', 'checkout', 'sensitive_order_history',
  'show_mortgage', 'get_weather', 'brave_news_search', 'code_search',
]);
// Real A2A (owner, 2026-11-16): the chained exchange (AI-DEMO2 a2aDelegationService) runs Real for the use cases whose whole chain is the plain two-agent
// hand-off (UC2, UC2.5: banking's Investment Advisor, tool get_portfolio_summary) when the AAG_A2A_* settings are complete. The agent card, the A2A
// protocol messages, the mismatch probe and the signed assertion (UC2.6, UC2.7, UC37) are staged by the mock engine only. (The SE agent-service is NOT
// needed: it is reasoning-only, the BFF holds token custody.)
export const A2A_VERTICAL = 'banking';
const A2A_REAL_CHAIN = new Set(['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched']);
export const TOOL_NEEDS = {};
// Trusted-caller features: they need headers a caller must never send (forced actor, rate-limit toggle, TraT). UC21 (entitlement tiers) is NOT one in Real
// (owner 2026-11-16): the tier is the signed-in user's own PingOne group, so it runs Real; the owner flips the group in PingOne and signs in again.
const TRUSTED_FEATURE = { UC13: 'the forced actor', UC18: 'the rate-limit toggle' };
const A2A = /^a2a-|^verified-trust-issuance$/;
const PRIVILEGE_LANE = /^(privilege-gateway-leg|credential-swap|enterprise-managed-mode|id-jag-)/;
const APPROVAL = new Set(['ciba-poll', 'ciba-authorize', 'hitl-receipt']);

// Feature flags whose product feature the lab's own tool server does not need: UC9's flag is about AI-DEMO2's group policy, and the tool server enforces the
// group rule itself. Every other flag (ciba_enabled, ff_rar, ff_dpop, ff_enterprise_managed_mcp_auth, ...) still keeps the use case on the lab's own steps.
export const LOCAL_FLAG_OK = new Set(['ff_authorize_group_policy']);
const GATEWAY_MISSING = 'the SE gateway is not set up here (AAG_AGENT_GATEWAY_URL, AAG_GATEWAY_AUDIENCE, AAG_GATEWAY_SCOPE)';
// A partial or invalid trio is named: the setting problem is fixed words from real.js (never a value).
const gatewayWhy = (problem) => (typeof problem === 'string' && problem ? `the SE gateway is not set up here: ${problem}` : GATEWAY_MISSING);
// What the lab says about its own tool server when it is not up, by the state the supervisor is in (the default is the plain "not running here").
const localDown = (st) => (st === 'starting' ? "the lab's tool server is restarting here" : st === 'failed' ? "the lab's tool server stopped here and could not be restarted yet (it is tried again on a later run)" : "the lab's tool server is not running here");
const GATEWAY_LOCAL_ONLY = 'AAG_PROVIDER=local is set and the local tool server serves the software vertical only';

// { real: true, tool, capability } or { real: false, reason } (fixed words; the reason names the part that keeps it on the lab's own steps).
// opts.a2a: the AAG_A2A_* settings are complete and the vertical is A2A_VERTICAL; opts.a2aWhy: the fixed words saying why not, when they are not.
// opts.tools / opts.gateway / opts.setting: what providers.snapshot() says is available (provider.js); the defaults say nothing is.
export function realGate(uc, cast, { a2a = false, a2aWhy = null, tools = { se: false, local: false }, gateway = false, gatewayProblem = null, setting = 'auto' } = {}) {
  if (!isFlow(uc)) return { real: false, reason: 'it is a guided page: the lab shows it and does not compute it' };
  // The pack's tools are served by a tool server, not the SE gateway (castToolServer, software): the capability decides which provider can answer.
  const capability = cast && Object.hasOwn(cast, 'castToolServer') ? 'tools' : 'gateway';
  const chain = chainOf(uc);
  // Owner 2026-11-13: UC7/UC8 (the hitl track, tool create_transfer) run REAL — the SE gateway's HITL pipeline
  // (428 + challenge, the HITL service, the receipt retry) is live and this lab drives it with the mock phone.
  // The other approval kinds stay simulated: CIBA needs an out-of-band device flow, elicitation an interactive answer.
  if (uc.track === 'hitl' && !['UC7', 'UC8'].includes(uc.id)) return { real: false, reason: 'its human approval (CIBA or elicitation) is staged by the lab only' };
  if (uc.track !== 'hitl' && chain.some((k) => APPROVAL.has(k))) return { real: false, reason: 'its human approval (CIBA or elicitation) is staged by the lab only' };
  if (Object.hasOwn(TRUSTED_FEATURE, uc.id)) return { real: false, reason: `${TRUSTED_FEATURE[uc.id]} is a trusted-caller feature, and this lab never sends trusted-caller headers` };
  if (/\btrat\b|transaction token/i.test(`${uc.title} ${uc.pingOneSolution}`)) return { real: false, reason: 'transaction tokens (TraT) are a trusted-caller feature, and this lab never sends trusted-caller headers' };
  if (chain.some((k) => A2A.test(k)) || uc.primaryTool === 'get_portfolio_summary') {
    if (uc.primaryTool !== 'get_portfolio_summary' || !chain.every((k) => A2A_REAL_CHAIN.has(k))) return { real: false, reason: 'its agent-to-agent (A2A) steps (the agent card, the protocol messages, a mismatch probe or a signed assertion) are staged by the lab only' };
    if (!a2a) return { real: false, reason: a2aWhy || 'the agent-to-agent (A2A) chain needs the specialist agent\'s PingOne settings (AAG_A2A_*), which are not set' };
    if (capability === 'tools') return { real: false, reason: 'the agent-to-agent (A2A) chain runs through the SE gateway, which serves banking only' };
    if (setting === 'local') return { real: false, reason: GATEWAY_LOCAL_ONLY };
    if (!gateway) return { real: false, reason: gatewayWhy(gatewayProblem) };
    return { real: true, tool: toolFor(cast, uc.primaryTool), a2a: true, capability: 'gateway' };
  }
  if (chain.some((k) => PRIVILEGE_LANE.test(k)) || (uc.needs || []).includes('privilege')) return { real: false, reason: 'the Privilege, PingFederate and ID-JAG lanes are not part of this Real path' };
  if (chain.includes('personal-agent-lookup')) return { real: false, reason: 'the personal-agent lane is not part of this Real path' };
  if (chain.some((k) => k.startsWith('sim-'))) return { real: false, reason: 'it stages an attack, which only the lab can stage' };
  if (uc.flag && !(capability === 'tools' && LOCAL_FLAG_OK.has(uc.flag))) return { real: false, reason: `it needs the AI-DEMO2 feature flag ${uc.flag}, which is not known to be on in SE` };
  if (!uc.primaryTool) return { real: false, reason: 'it calls no tool, so there is nothing for the SE MCP server to run' };
  const tool = toolFor(cast, uc.primaryTool);
  if (Object.hasOwn(TOOL_NEEDS, tool)) return { real: false, reason: `its tool ${tool} needs ${TOOL_NEEDS[tool]}` };
  if (capability === 'tools') {
    if (!LOCAL_TOOLS.has(tool)) return { real: false, reason: `its tool ${tool} is not served by the lab's tool server` };
    if (setting === 'se' && !tools.se) return { real: false, reason: 'AAG_PROVIDER=se is set and AAG_TOOLS_SE_URL is not' };
    if (setting === 'local' && !tools.local) return { real: false, reason: `AAG_PROVIDER=local is set and ${localDown(tools.localState)}` };
    if (setting === 'auto' && !tools.se && !tools.local) return { real: false, reason: `${localDown(tools.localState)} and AAG_TOOLS_SE_URL is not set` };
    return { real: true, tool, capability: 'tools' };
  }
  if (!SE_MCP_TOOLS.has(tool)) return { real: false, reason: `its tool ${tool} is not served by the SE mcp-server` };
  if (setting === 'local') return { real: false, reason: GATEWAY_LOCAL_ONLY };
  if (!gateway) return { real: false, reason: gatewayWhy(gatewayProblem) };
  return { real: true, tool, capability: 'gateway' };
}

// The arguments the lab sends for each tool (lab-invented, labelled). Account ids come from get_my_accounts in the same session (the user's own).
// Every value is a string or number this table or a situation fixed, never visitor text (`said` is not a tool argument).
export const NEEDS_ACCOUNTS = new Set(['get_account_balance', 'create_transfer', 'request_fee_waiver']);
export function toolArgs(tool, { vertical, accounts = [], amount, args }) {
  const a0 = accounts[0] ?? null; const a1 = accounts[1] ?? accounts[0] ?? null;
  const amt = Number.isFinite(amount) ? amount : 25;
  switch (tool) {
    case 'get_account_balance': return { account_id: a0 };
    case 'create_transfer': return { from_account_id: a0, to_account_id: a1, amount: amt, description: 'Customer Agent LAB' };
    case 'request_fee_waiver': return { account_id: a0, reason: 'Customer request' };
    case 'get_branch_hours': return { vertical };
    case 'pay_bill': case 'checkout': return { amount: amt };
    // The third-party tools take what the use case stages (situations.js args: a state, a search query). Parameter names are UNVERIFIED against SE.
    case 'get_weather': return { state: typeof args?.state === 'string' ? args.state : 'TX' };
    case 'brave_news_search': case 'code_search': return { query: typeof args?.query === 'string' ? args.query : 'status' };
    // The software vertical's tool server (design-real-local.md B.8).
    case 'get_my_issues': return { limit: 5 };
    case 'bulk_update_issues': return { project: 'PLAT', issue_count: amt, field: 'status', value: 'Done' };
    case 'get_project_security_settings': return { project: 'PLAT' };
    case 'get_release_summary': return {};
    case 'list_marketplace_apps': return { limit: 5 };
    case 'get_deployment_status': return { environment: 'production' };
    case 'request_admin_access': return { role: 'project-admin', project: 'PLAT', reason: 'Lab request: approve the release' };
    case 'scan_repository': return { repo: typeof args?.repo === 'string' ? args.repo : 'platform' };
    default: return {};
  }
}
