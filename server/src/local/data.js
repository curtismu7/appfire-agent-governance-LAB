// Synthetic data for the tool server. Everything here is lab-invented: no real person, host, product record or tenant. Hosts are .example or TEST-NET.
export const ISSUES = [
  { key: 'PLAT-412', summary: 'Rate limiter returns 500 on burst', status: 'In Progress', priority: 'High' },
  { key: 'PLAT-418', summary: 'Upgrade build image to Node 26', status: 'To Do', priority: 'Medium' },
  { key: 'PLAT-421', summary: 'Audit log export times out', status: 'In Review', priority: 'High' },
  { key: 'BILL-77', summary: 'Invoice rounding on partial refunds', status: 'To Do', priority: 'Medium' },
  { key: 'BILL-80', summary: 'Add tax id to checkout form', status: 'In Progress', priority: 'Low' },
  { key: 'MOB-203', summary: 'Crash on rotate in release list', status: 'To Do', priority: 'High' },
  { key: 'MOB-205', summary: 'Dark theme contrast on badges', status: 'In Review', priority: 'Low' },
  { key: 'PLAT-430', summary: 'Document the deploy checklist', status: 'Done', priority: 'Low' },
];

export const APPS = [
  { name: 'Sprint Pulse', vendor: 'Example Vendor', category: 'Reporting', installs: 1200 },
  { name: 'Release Radar', vendor: 'Example Vendor', category: 'Automation', installs: 980 },
  { name: 'Bulk Mover', vendor: 'Example Vendor', category: 'Automation', installs: 860 },
  { name: 'Audit Trail Plus', vendor: 'Example Vendor', category: 'Compliance', installs: 410 },
  { name: 'Epic Roadmap', vendor: 'Example Vendor', category: 'Planning', installs: 2300 },
];

export const NEWS = [
  { title: 'Ten ways teams tune Jira workflows (example)', url: 'https://news.example/jira-workflow-tuning', snippet: 'A lab-invented article about workflow states and transitions.' },
  { title: 'Release trains and issue hygiene (example)', url: 'https://news.example/release-trains', snippet: 'A lab-invented article about keeping a release board clean.' },
  { title: 'Automation rules that save an hour a day (example)', url: 'https://news.example/automation-rules', snippet: 'A lab-invented article about rules that move issues on their own.' },
];

export const CODE_MATCHES = [{ repo: 'platform', path: 'src/limiter.js', line: 42, text: '// example match' }];

export const SECURITY_SETTINGS = {
  visibility: 'private', two_step_verification: 'required', ip_allowlist: ['203.0.113.0/24'], permission_scheme: 'Standard', audit_log_retention_days: 365, secrets_scanning: 'enabled',
};
