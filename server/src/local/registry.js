// The tool registry: which tools exist, the scope each needs, who may see them. The provider side keeps a copy of these names and a parity test compares.
// Read TOOL_META with Object.hasOwn only (a request may name __proto__ or constructor).
export const TOOL_META = {
  get_my_issues: { scope: 'issues:read', role: 'read', public: false, group: false, pack: 'software' },
  bulk_update_issues: { scope: 'issues:write', role: 'write', public: false, group: false, pack: 'software' },
  get_project_security_settings: { scope: 'security:read', role: 'sensitive', public: false, group: true, pack: 'software' },
  get_release_summary: { scope: 'release:read', role: 'a2a', public: false, group: false, pack: 'software' },
  list_marketplace_apps: { scope: null, role: 'public', public: true, group: false, pack: 'software' },
  get_deployment_status: { scope: 'deploy:read', role: 'status', public: false, group: false, pack: 'software' },
  request_admin_access: { scope: 'admin:request', role: 'request', public: false, group: false, pack: 'software' },
  scan_repository: { scope: 'security:read', role: 'scan', public: false, group: false, pack: 'software' },
  brave_news_search: { scope: 'issues:read', role: 'search', public: false, group: false, pack: 'software' },
  code_search: { scope: 'issues:read', role: 'search', public: false, group: false, pack: 'software' },
  // The airline pack (Larkspur Air, LAB-INVENTED). The pack decides which tier group a group-gated tool needs.
  get_airline_bookings: { scope: 'trips:read', role: 'read', public: false, group: false, pack: 'airline' },
  get_flight_status: { scope: 'flights:read', role: 'status', public: false, group: false, pack: 'airline' },
  book_airline_flight: { scope: 'flights:book', role: 'write', public: false, group: false, pack: 'airline' },
  sensitive_passenger_record: { scope: 'travellers:read', role: 'sensitive', public: false, group: true, pack: 'airline' },
  list_airports: { scope: null, role: 'public', public: true, group: false, pack: 'airline' },
  request_change_fee_waiver: { scope: 'fees:request', role: 'request', public: false, group: false, pack: 'airline' },
};
// The eleven scopes of the PingOne resource "Appfire Work Suite Tools": the six software ones, then the five airline ones.
export const SCOPES = ['issues:read', 'issues:write', 'security:read', 'release:read', 'deploy:read', 'admin:request',
  'trips:read', 'flights:read', 'flights:book', 'travellers:read', 'fees:request'];
// The airline pack's fare rule, LAB-INVENTED. A copy of server/src/policy.js FARE_RULE (local/* may not import the lab); localParity.test.js pins equality.
export const FARE = Object.freeze({ limit: 400, hold: 1500, from: 'business', to: 'economy' });
export const DEFAULT_AIRLINE_TIER_GROUP = 'Airline_OrbitTier';
// The lab's own bands for bulk_update_issues (the number of issues). The CIBA band (100 to 199) is reserved and not enforced here.
export const BANDS = [
  { min: 2000, decision: 'DENY', rule: 'lab-band-deny' },
  { min: 500, decision: 'STEP_UP', rule: 'lab-band-step-up' },
  { min: 200, decision: 'HITL_REQUIRED', rule: 'lab-band-hold' },
];
export const SCANNER_REPOS = ['platform', 'billing', 'mobile'];
export const BLOCKED_TERMS = ['bitcoin', 'crypto'];

// PingOne Authorize (phase C, design-authorize-lab.md B.1): the nine answers the parent may send back over IPC, and the words for a "no decision". The parent keeps its own
// copy in server/src/authorize.js (CODES, REASON_WORDS) and a parity test pins the two equal. `because` is what the tool server applies for a narrowing, derived from the code.
export const AUTHORIZE_CODES = Object.freeze({
  'airline-permit-as-asked': Object.freeze({ outcome: 'permit', because: Object.freeze([]) }),
  'airline-economy-intl': Object.freeze({ outcome: 'narrow', because: Object.freeze(['international']) }),
  'airline-economy-over-limit': Object.freeze({ outcome: 'narrow', because: Object.freeze(['over-limit']) }),
  'airline-economy-intl-over-limit': Object.freeze({ outcome: 'narrow', because: Object.freeze(['international', 'over-limit']) }),
  'airline-approval-required': Object.freeze({ outcome: 'approval', because: Object.freeze([]) }),
  'airline-approved-as-asked': Object.freeze({ outcome: 'approved', because: Object.freeze([]) }),
  'airline-second-factor-required': Object.freeze({ outcome: 'second_factor', because: Object.freeze([]) }),
  'airline-booking-refused': Object.freeze({ outcome: 'deny', because: Object.freeze([]) }),
});
export const AUTHORIZE_REASONS = Object.freeze(['not_applicable', 'indeterminate', 'no_airline_code', 'only_unmatched', 'ambiguous', 'unrecognised', 'malformed', 'rate_limited',
  'refused_credential', 'endpoint', 'server_error', 'unreachable', 'timeout', 'busy', 'unavailable']);
