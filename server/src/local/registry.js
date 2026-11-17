// The tool registry: which tools exist, the scope each needs, who may see them. The provider side keeps a copy of these names and a parity test compares.
// Read TOOL_META with Object.hasOwn only (a request may name __proto__ or constructor).
export const TOOL_META = {
  get_my_issues: { scope: 'issues:read', role: 'read', public: false, group: false },
  bulk_update_issues: { scope: 'issues:write', role: 'write', public: false, group: false },
  get_project_security_settings: { scope: 'security:read', role: 'sensitive', public: false, group: true },
  get_release_summary: { scope: 'release:read', role: 'a2a', public: false, group: false },
  list_marketplace_apps: { scope: null, role: 'public', public: true, group: false },
  get_deployment_status: { scope: 'deploy:read', role: 'status', public: false, group: false },
  request_admin_access: { scope: 'admin:request', role: 'request', public: false, group: false },
  scan_repository: { scope: 'security:read', role: 'scan', public: false, group: false },
  brave_news_search: { scope: 'issues:read', role: 'search', public: false, group: false },
  code_search: { scope: 'issues:read', role: 'search', public: false, group: false },
};
// The six scopes of the PingOne resource "Appfire Work Suite Tools".
export const SCOPES = ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request'];
// The lab's own bands for bulk_update_issues (the number of issues). The CIBA band (100 to 199) is reserved and not enforced here.
export const BANDS = [
  { min: 2000, decision: 'DENY', rule: 'lab-band-deny' },
  { min: 500, decision: 'STEP_UP', rule: 'lab-band-step-up' },
  { min: 200, decision: 'HITL_REQUIRED', rule: 'lab-band-hold' },
];
export const SCANNER_REPOS = ['platform', 'billing', 'mobile'];
export const BLOCKED_TERMS = ['bitcoin', 'crypto'];
