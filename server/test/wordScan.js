// The words the page must not say (owner, 2026-11-16: "demo watchers do not need to know"): mock, simulated, and the lab's own jargon for it.
// A walker over any JSON the server sends. What it does NOT read is protocol data, not words to a viewer: the raw request and response bodies of a hop,
// the token (raw, header, claims), and the keys and values that name the engine in the API (hop.mock, hop.source, run.mode, the hand-off app id, the
// config names ALLOW_MOCK_SIGNIN and IDP). The exceptions below are named, each with its reason.
// 'Scripted' (the brain's name) stays: owner decision 2026-11-16, Q4.
export const BANNED = /mock|simulat|offline|\bengine\b/i;
// Subtrees that are raw protocol data.
const RAW_KEYS = new Set(['request', 'response', 'raw', 'header', 'claims', 'castMockOnly', 'app']);
// Keys whose string value names the engine in the API.
const DATA_VALUE_KEYS = new Set(['source', 'mode', 'kid', 'schema', 'brain']);
// Named, owner-approved or vendored exceptions (strings, after the config names are removed).
export const EXCEPTIONS = [
  // Owner decision 2026-11-16 (Q3): the UC15 admission that the catalog marks it needs-build stays.
  /^The source marks this use case needs-build: it is lab-simulated here, not claimed to work in the product\.$/,
  // Vendored shared hop catalog (server/src/vendor/hop-catalog.json): the llm-plan teaching sentence. Fixed upstream in AI-DEMO-Standalone first, then re-vendored.
  /scripted intent match \(mock\)/i,
  // Vendored hop catalog, same upstream fix: two "failure" teaching sentences that say "the engine" for the policy engine.
  /^Assuming a DENY came from your rule\. A DENY proves the engine answered, not which rule fired/,
  /^Presenting a guide as a computed result\. Nothing here was decided by the engine\.$/,
];
// Config names and the names inside the tokens (owner 2026-11-16, Q4: JWT claim values and hostnames stay as data); "policy engine" is a product term.
const CONFIG_NAMES = /ALLOW_MOCK_SIGNIN|IDP=mock|customer-app-mock|idp\.mock\.example|mock-key-1|operator-service-mock|policy[- ]engine/gi;

export function findWords(value, where = '$') {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === 'string') {
      const text = v.replace(CONFIG_NAMES, '');
      if (BANNED.test(text) && !EXCEPTIONS.some((re) => re.test(v))) hits.push(`${p}: ${v.length > 160 ? `${v.slice(0, 160)}...` : v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (RAW_KEYS.has(k)) continue;
        if (DATA_VALUE_KEYS.has(k) && typeof x === 'string') continue;
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(value, where);
  return hits;
}
