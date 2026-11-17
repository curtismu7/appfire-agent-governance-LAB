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

// The airline pack (Larkspur Air): LAB-INVENTED. `country` decides `international`; `miles_away` is the lab's invented distance from the traveller.
export const AIRPORTS = {
  MDW: { name: 'Midway', city: 'Chicago', country: 'US', miles_away: 14 }, ORD: { name: "O'Hare", city: 'Chicago', country: 'US', miles_away: 17 },
  DEN: { name: 'Denver', city: 'Denver', country: 'US', miles_away: 920 }, SFO: { name: 'San Francisco', city: 'San Francisco', country: 'US', miles_away: 1840 },
  SEA: { name: 'Seattle-Tacoma', city: 'Seattle', country: 'US', miles_away: 1720 }, BOS: { name: 'Logan', city: 'Boston', country: 'US', miles_away: 860 },
  LAX: { name: 'Los Angeles', city: 'Los Angeles', country: 'US', miles_away: 1750 }, HNL: { name: 'Honolulu', city: 'Honolulu', country: 'US', miles_away: 4240 },
  YYZ: { name: 'Toronto Pearson', city: 'Toronto', country: 'CA', miles_away: 440 }, CDG: { name: 'Charles de Gaulle', city: 'Paris', country: 'FR', miles_away: 4170 },
  LHR: { name: 'Heathrow', city: 'London', country: 'GB', miles_away: 3950 },
};
// One listed fare per flight: the price of the business seat the lab asks for (no fare table by class). The table equals the README's airline table and the situations.
export const FLIGHTS = {
  'LK 109': { from: 'ORD', to: 'DEN', fare: 150, day: 'Friday', time: '6:05 am', gate: 'B4' },
  'LK 214': { from: 'ORD', to: 'DEN', fare: 380, day: 'Friday', time: '8:15 am', gate: 'B12' },
  'LK 322': { from: 'ORD', to: 'YYZ', fare: 380, day: 'Friday', time: '9:40 am', gate: 'C9' },
  'LK 330': { from: 'ORD', to: 'SFO', fare: 400, day: 'Friday', time: '7:30 am', gate: 'B7' },
  'LK 331': { from: 'ORD', to: 'SEA', fare: 401, day: 'Friday', time: '10:10 am', gate: 'B9' },
  'LK 560': { from: 'ORD', to: 'BOS', fare: 780, day: 'December 4', time: '12:20 pm', gate: 'C3' },
  'LK 650': { from: 'ORD', to: 'LAX', fare: 1500, day: 'Friday', time: '3:05 pm', gate: 'B15' },
  'LK 651': { from: 'ORD', to: 'HNL', fare: 1501, day: 'Friday', time: '11:55 am', gate: 'B18' },
  'LK 704': { from: 'ORD', to: 'CDG', fare: 2400, day: 'November 28', time: '9:30 pm', gate: 'C22' },
  'LK 800': { from: 'ORD', to: 'LHR', fare: 1100, day: 'Friday', time: '6:45 pm', gate: 'C25' },
};
export const FLIGHT_IDS = Object.keys(FLIGHTS);
// DERIVED, never stored and never taken from the caller.
export const isInternational = (f) => AIRPORTS[f.from].country !== AIRPORTS[f.to].country;
// The signed-in traveller's trips: one fixed list for everyone, like the software issues list.
export const TRIPS = [
  { flight: 'LK 214', route: 'ORD to DEN', departs: 'Friday 8:15 am', seat: '14C', cabin: 'business', status: 'confirmed' },
  { flight: 'LK 560', route: 'ORD to BOS', departs: 'December 4 12:20 pm', seat: '22A', cabin: 'economy', status: 'confirmed' },
];
export const MILES = 18400;
export const TRAVELLER = { passport_last4: '4471', card_last4: '4821' };
