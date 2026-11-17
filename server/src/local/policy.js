// The lab's own enforcement for tools/call (design B.6): the decision order, the bands, the group gate, the edge rules.
// A refusal here is the lab's policy, not PingOne Authorize. Every string is fixed text: no token, claim value, secret or request text.
import { BANDS, BLOCKED_TERMS, SCANNER_REPOS, TOOL_META } from './registry.js';
import { argsDigest } from './hitl.js';
import { runTool, validateArgs } from './tools.js';

export const BY = 'tool server';
// The blocked-term demo rule reads the query the way a person would: compatibility-folded, with zero-width, soft-hyphen and combining characters removed. It is a
// teaching rule of this lab, not a security control.
const foldForTerms = (text) => text.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]|\p{M}/gu, '').toLowerCase();
const body = (error, message, reason, extra = {}) => ({ error, message, reason, by: BY, ...extra });
const audit = (decision, rule) => ({ decision, rule });

// Is a tool visible to this caller in tools/list? auth is the verifier's success object or null (no token).
export function listedFor(name, auth, tierGroup) {
  const meta = TOOL_META[name];
  if (meta.public) return true;
  if (!auth || !auth.scopes.includes(meta.scope)) return false;
  return !meta.group || auth.groups.includes(tierGroup);
}

// Returns one of:
//   { kind: 'rpc_error', code: -32602, message }
//   { kind: 'refuse', status, body, audit: { decision, rule } | null, wwwAuthenticate?: string }
//   { kind: 'permit', payload, audit }
export function decide({ name, rawArgs, auth, config, hitl, now }) {
  if (!Object.hasOwn(TOOL_META, name)) return { kind: 'rpc_error', code: -32602, message: 'unknown tool' };
  const meta = TOOL_META[name];

  // 2. scope
  if (meta.scope && !(auth && auth.scopes.includes(meta.scope))) {
    return {
      kind: 'refuse', status: 403, audit: audit('DENY', 'lab-scope'),
      body: body('insufficient_scope', 'The token does not carry the scope this tool needs.', 'lab-scope', { required_scope: meta.scope }),
      wwwAuthenticate: `Bearer realm="appfire-tools-local", error="insufficient_scope", scope="${meta.scope}"`,
    };
  }
  // 3. arguments
  const checked = validateArgs(name, rawArgs);
  if (!checked.ok) return { kind: 'rpc_error', code: -32602, message: checked.text };
  const { args, receipt } = checked;
  // 4. group gate (applies whether or not the tool was listed to this caller)
  if (meta.group && !(auth && auth.groups.includes(config.tierGroup))) {
    return {
      kind: 'refuse', status: 403, audit: audit('DENY', 'lab-group-gate'),
      body: body('group_required', "The tier group is missing from the token's groups claim.", 'lab-group-gate', { required_group: config.tierGroup }),
    };
  }
  // 5. edge rules
  if (name === 'scan_repository' && !SCANNER_REPOS.includes(args.repo.toLowerCase())) {
    return {
      kind: 'refuse', status: 403, audit: audit('DENY', 'lab-repo-allowlist'),
      body: body('repo_not_allowed', 'the code scanner is configured for the platform, billing and mobile repositories only', 'lab-repo-allowlist'),
    };
  }
  if (name === 'brave_news_search' && BLOCKED_TERMS.some((t) => foldForTerms(args.query).includes(t))) {
    return {
      kind: 'refuse', status: 403, audit: audit('DENY', 'lab-blocked-term'),
      body: body('blocked_term', 'the query contains a blocked term', 'lab-blocked-term'),
    };
  }
  // 6. bands (bulk_update_issues only, on the number of issues)
  if (name === 'bulk_update_issues') {
    const band = BANDS.find((b) => args.issue_count >= b.min);
    if (band?.decision === 'DENY') {
      return {
        kind: 'refuse', status: 403, audit: audit('DENY', band.rule),
        body: body('access_denied', 'This change is larger than the lab policy allows. Nothing was changed.', band.rule),
      };
    }
    if (band?.decision === 'STEP_UP') {
      return {
        kind: 'refuse', status: 428, audit: audit('STEP_UP', band.rule),
        body: body('step_up_required', 'This write needs a stronger authentication (a second factor). The lab policy stops it here.', band.rule),
      };
    }
    if (band?.decision === 'HITL_REQUIRED') {
      const digest = argsDigest(rawArgs);
      if (receipt) {
        const v = hitl.verify(receipt, { sub: auth.claims.sub, tool: name, argsDigest: digest });
        if (!v.valid) return { kind: 'refuse', status: 403, audit: null, body: body('hitl_receipt_rejected', 'The approval receipt was refused.', v.reason) };
      } else {
        const made = hitl.create({ sub: auth.claims.sub, tool: name, argsDigest: digest, amount: args.issue_count });
        if (!made.ok) return { kind: 'refuse', status: 503, audit: null, body: body('capacity', 'The approval service is full. Try again later.', 'capacity') };
        return {
          kind: 'refuse', status: 428, audit: audit('HITL_REQUIRED', band.rule),
          body: body('approval_required', 'This write needs a person to approve it.', band.rule, { challengeId: made.id, expiresAt: made.expiresAt, tool: name }),
        };
      }
    }
  }
  // 7. run
  return { kind: 'permit', audit: audit('PERMIT', 'lab-no-restriction'), payload: runTool(name, args, { sub: auth ? auth.claims.sub : null, now }) };
}
