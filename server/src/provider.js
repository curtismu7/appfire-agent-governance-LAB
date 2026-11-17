// Which provider answers a Real run (owner decision, 2026-11-16): every real capability has an SE provider and a LOCAL provider shipped in the lab's own
// image. `auto` = SE when its settings are present and a cheap probe of its MCP url passes, else local; AAG_PROVIDER=auto|se|local overrides. The choice is made
// ONCE per run (app.js calls choose() before real.run) and never switches mid-run: a failure of the picked provider is an honest "no decision".
// Capabilities: 'gateway' (banking, healthcare, retail: only the SE Agent Gateway exists) and 'tools' (the software vertical: an SE-hosted instance of the
// tool server, or the lab's own tool server forked by localServices.js). The page never says which answered: the DATA does (hop.provider, hop.answeredBy).
//
// Pins (design-real-local.md C.1): this module reads no environment variable, imports nothing from real.js, realGate.js or app.js (it receives `real` by
// injection), builds no regular expression from input and never names a client secret.

export const PROVIDER_SETTINGS = ['auto', 'se', 'local'];
const READY_WAIT_MS = 5_000;
// '' or undefined is auto; anything that is not auto, se or local (any case) is null: a configuration problem for the caller to name.
export const providerSettingOf = (raw) => {
  if (raw === undefined || raw === null || raw === '') return 'auto';
  if (typeof raw !== 'string') return null;
  const v = raw.toLowerCase();
  return PROVIDER_SETTINGS.includes(v) ? v : null;
};

// The tool names the local tool server serves, with the scope each needs: a copy of server/src/local/registry.js TOOL_META (localParity.test.js pins equality).
export const LOCAL_TOOLS = new Set([
  'get_my_issues', 'bulk_update_issues', 'get_project_security_settings', 'get_release_summary', 'list_marketplace_apps',
  'get_deployment_status', 'request_admin_access', 'scan_repository', 'brave_news_search', 'code_search',
]);
export const TOOL_SCOPES = {
  get_my_issues: 'issues:read', bulk_update_issues: 'issues:write', get_project_security_settings: 'security:read', get_release_summary: 'release:read',
  list_marketplace_apps: null, get_deployment_status: 'deploy:read', request_admin_access: 'admin:request', scan_repository: 'security:read',
  brave_news_search: 'issues:read', code_search: 'issues:read',
};
export const PUBLIC_TOOLS = new Set(['list_marketplace_apps']);
// Hidden from tools/list unless the token's groups claim holds the tier group (design R3); a call to it is still refused (403 group_required).
export const GROUP_GATED_TOOLS = new Set(['get_project_security_settings']);
// Use cases that call a tool even when tools/list does not offer it (UC9 is the probe: it shows the call-time 403 for a user outside the tier group).
export const CALL_UNLISTED = new Set(['UC9']);

export const toolScopeOf = (tool) => (typeof tool === 'string' && Object.hasOwn(TOOL_SCOPES, tool) ? TOOL_SCOPES[tool] : null);

const GATEWAY_ANSWERED_BY = 'Agent Gateway (SE)';
const GATEWAY_LABEL = 'Agent Gateway [SE]';
export const TOOLS_SE_ANSWERED_BY = 'tool server (SE)';
export const TOOLS_LOCAL_ANSWERED_BY = 'tool server (local)';

// The cheap SE probe: an unauthenticated MCP `initialize` POSTed to the SE tool server's own MCP url (the route the run will use, so a shared ingress with no /health
// route, or one that answers /health for another service, cannot fool it). HTTP 200 (it answered) or 401 (it answered and wants a token) is up. Only the MCP
// protocol headers go, redirect manual, 3 s, never a token or a lab header, no body read beyond what a cancel drops. UNVERIFIED against the real SE tool server.
async function probeUrl(url, fetchImpl, timeoutMs) {
  try {
    const target = new URL(url).toString();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'appfire-agent-governance-lab-probe', version: '1' } } });
    const res = await fetchImpl(target, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const ok = res.status === 200 || res.status === 401;
    try { await res.body?.cancel(); } catch { /* nothing to read */ }
    return ok;
  } catch { return false; }
}

// real: the configured Real object, read through four sync accessors only: real.configured(), real.gateway() ({ url, audience, scope } or null), real.gatewayProblem() (optional),
// real.toolsAudience() and real.toolsSeUrl() (a string or null). local: createLocalServices(...) or null. hosted: nothing is forked, probed or reached.
export function createProviders({ setting = 'auto', real = null, local = null, toolsSe = undefined, hosted = false, fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now, probeTtlMs = 30_000, probeTimeoutMs = 3_000 } = {}) {
  const chosen = providerSettingOf(setting) ?? 'auto';
  const probes = new Map(); // MCP url -> { at, ok } or { at, promise }
  const gateway = () => (!hosted && real?.configured?.() ? real.gateway?.() ?? null : null);
  // Fixed words naming the setting (never a value) when the SE gateway trio is partial or invalid: the gate quotes them so the page says what is wrong, not just that it is off.
  const gatewayProblem = () => (!hosted && real?.configured?.() && typeof real.gatewayProblem?.() === 'string' ? real.gatewayProblem() : null);
  const toolsAudience = () => real?.toolsAudience?.() ?? 'appfire-work-tools';
  // The SE-hosted tool server's MCP url: the explicit `toolsSe` ({ url }, or null for none) wins, else what real says.
  const seUrl = () => {
    if (hosted || !real?.configured?.()) return null;
    const u = toolsSe === undefined ? real.toolsSeUrl?.() ?? null : toolsSe?.url ?? null;
    return typeof u === 'string' && u ? u : null;
  };
  const localReady = () => !hosted && local?.state?.() === 'ready' && typeof local.mcpUrl?.() === 'string';
  // The tool server may be between a crash and its restart (1 to 4 s), or may have given up and be due another try. A run waits for it briefly here, before its gate and its
  // pick, so that window is not a silent switch to the lab's own steps. Never forks anything itself: local.ready() does, and only after its own cool-down.
  const prepare = async () => {
    if (hosted || chosen === 'se' || !local) return;
    const st = local.state?.();
    if (st === 'starting' || st === 'failed') await local.ready?.(READY_WAIT_MS);
  };

  const snapshot = () => (hosted
    ? { setting: 'auto', gateway: false, tools: { se: false, local: false } }
    : { setting: chosen, gateway: Boolean(gateway()), ...(!gateway() && gatewayProblem() ? { gatewayProblem: gatewayProblem() } : {}), tools: { se: Boolean(seUrl()), local: localReady(), localState: local?.state?.() ?? 'off' } });

  async function probe(url) {
    const key = new URL(url).toString();
    const have = probes.get(key);
    if (have?.promise) return have.promise;
    if (have && now() - have.at < probeTtlMs) return have.ok;
    const promise = probeUrl(url, fetchImpl, probeTimeoutMs).then((ok) => { probes.set(key, { at: now(), ok }); return ok; });
    probes.set(key, { at: now(), promise });
    return promise;
  }

  const gatewayPick = (gw, why) => ({ provider: 'se', capability: 'gateway', url: gw.url, audience: gw.audience, scope: gw.scope, why, answeredBy: GATEWAY_ANSWERED_BY, label: GATEWAY_LABEL });
  const toolsSePick = (why) => ({ provider: 'se', capability: 'tools', url: seUrl(), audience: toolsAudience(), scope: null, why, answeredBy: TOOLS_SE_ANSWERED_BY, label: 'Tool server [SE]' });
  const toolsLocalPick = (why) => ({ provider: 'local', capability: 'tools', url: local.mcpUrl(), audience: toolsAudience(), scope: null, why, answeredBy: TOOLS_LOCAL_ANSWERED_BY, label: 'Tool server [local]' });

  // Exactly the Pick of the design, or null when nothing can answer. Called once per run.
  async function choose({ capability } = {}) {
    if (hosted) return null;
    if (capability === 'gateway') {
      const gw = gateway();
      // Only SE has a gateway: AAG_PROVIDER=local has nothing to pick, and a probe is never consulted (there is no alternative to switch to).
      if (!gw || chosen === 'local') return null;
      return gatewayPick(gw, chosen === 'se' ? 'forced' : 'only-option');
    }
    if (capability === 'tools') {
      await prepare();
      const se = seUrl();
      if (chosen === 'se') return se ? toolsSePick('forced') : null;
      if (chosen === 'local') return localReady() ? toolsLocalPick('forced') : null;
      if (se && await probe(se)) return toolsSePick('auto-se-ok');
      if (localReady()) return toolsLocalPick(se ? 'auto-se-probe-failed' : 'auto-se-not-configured');
      return null;
    }
    return null; // an unknown capability (a later wave, such as CIBA) has no provider yet
  }

  const info = () => (hosted
    ? { setting: 'auto', hosted: true, gateway: false, toolsSe: false, local: { state: 'hosted', tools: 0 } }
    : { setting: chosen, hosted: false, gateway: Boolean(gateway()), toolsSe: Boolean(seUrl()), local: { state: local?.state?.() ?? 'off', tools: local?.toolNames?.().length ?? 0 } });

  return { setting: chosen, snapshot, prepare, choose, info };
}
