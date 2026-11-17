#!/usr/bin/env node
// OWNER-RUN. Makes the PingOne side of the lab's own tool server (the software vertical): ONE custom resource, its six scopes, its two attributes, the tier
// group, and the agent app's grant of the six scopes.
//
//   node scripts/owner/pingone-tools-setup.mjs            # dry run (default): reads PingOne, writes nothing, prints the plan
//   node scripts/owner/pingone-tools-setup.mjs --apply    # creates what is missing (nothing that exists is changed or replaced)
//
// Flags: --env-file <path> (default: this repo's .env; read only, for PINGONE_ENVIRONMENT_ID, PINGONE_REGION and AAG_AGENT_CLIENT_ID). Run
// scripts/owner/pingone-real-setup.mjs --apply first: this script needs the agent app it creates and writes nothing to the .env.
//
// What it makes (every name is fixed; a thing that already exists is reused and reported, never edited):
//   resource  "Appfire Work Suite Tools", audience appfire-work-tools (a custom resource: its access tokens are signed JWTs)
//   scopes    issues:read issues:write security:read release:read deploy:read admin:request
//   attributes  act     the subject token's act, passed through (so the delegated token keeps the agent in act.sub)
//               groups  the user's group names (memberOfGroupNames), which the tool server checks for the tier group
//   group     Software_EnterpriseTier (made empty: adding a user to it is the owner's step; the script never edits a membership)
//   grant     the AGENT app is granted all six scopes on that one resource (the lab's exchange 2 asks for ONE scope from this ONE resource per request:
//             PingOne refuses scopes from two resources in one request)
// UNVERIFIED against a real tenant: the groups expression below, and that the groups claim appears in an EXCHANGED token (only a client-credentials token
// was checked). The script reports an attribute that exists with another value as DRIFT and leaves it alone.
// Admin (org worker) credentials come from ~/.config/demo-kit/provisioning.json (STANDALONE_CRED_FILE overrides), as in pingone-real-setup.mjs. It never
// prints a secret, a password or an id: names, "found", "created", "would create". Agents never run this; the owner does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AGENT_APP_NAME, GATEWAY_ACT_PASSTHROUGH, client, clip, ensureGrant, plainId, readSettings, resolveTarget } from './pingone-real-setup.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TOOLS_RESOURCE_NAME = 'Appfire Work Suite Tools';
export const TOOLS_AUDIENCE = 'appfire-work-tools';
export const TIER_GROUP = 'Software_EnterpriseTier';
// PingOne rejects a description with any of $ + < = > ^ ` | ~ (HTTP 400 INVALID_VALUE on (description)): every description here is plain text.
export const TOOLS_RESOURCE = { name: TOOLS_RESOURCE_NAME, description: 'Appfire Agent Governance LAB: the tools of the lab\'s own tool server (invented data). Created by the owner setup script.', type: 'CUSTOM', audience: TOOLS_AUDIENCE };
export const TOOLS_SCOPES = [
  { name: 'issues:read', description: 'Read the signed-in person\'s issues' },
  { name: 'issues:write', description: 'Change issues in bulk' },
  { name: 'security:read', description: 'Read project security settings and run the code scan' },
  { name: 'release:read', description: 'Read a release summary' },
  { name: 'deploy:read', description: 'Read a deployment status' },
  { name: 'admin:request', description: 'Ask for admin access (a request only)' },
];
// The act attribute is the same subject-token pass-through the gateway resource uses (exchange 2 keeps the act that exchange 1 stamped).
export const ACT_EXPRESSION = GATEWAY_ACT_PASSTHROUGH;
// UNVERIFIED: the expression PingOne evaluates for the user's group names in an exchanged token.
export const GROUPS_EXPRESSION = '${user.memberOfGroupNames}';
export const TOOLS_ATTRIBUTES = [{ name: 'act', value: ACT_EXPRESSION }, { name: 'groups', value: GROUPS_EXPRESSION }];
export const TIER_GROUP_SPEC = { name: TIER_GROUP, description: 'Appfire Agent Governance LAB: the premium tier of the lab\'s tool server. Members are chosen by the owner.' };
// What the lab's .env may carry for this (all optional: the values shown are the defaults).
export const ENV_HINTS = [['AAG_PROVIDER', 'auto'], ['AAG_TOOLS_AUDIENCE', TOOLS_AUDIENCE], ['AAG_TOOLS_TIER_GROUP', TIER_GROUP]];

export function parseArgs(argv) {
  const o = { apply: false, envFile: path.join(repoRoot, '.env'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (a === '--dry-run') o.apply = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--env-file') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--env-file needs a value');
      o.envFile = path.resolve(v);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('--apply and --dry-run together: pick one');
  return o;
}

const same = (a, b) => String(a).replace(/\s+/g, '') === String(b).replace(/\s+/g, '');

export async function run(opts, { fetchImpl = fetch, log = console.log, credFile } = {}) {
  credFile = credFile || process.env.STANDALONE_CRED_FILE || path.join(os.homedir(), '.config', 'demo-kit', 'provisioning.json');
  log(opts.apply ? 'APPLY: missing PingOne objects for the tool server are created. Nothing that exists is changed.' : 'DRY RUN (default): PingOne is only read and nothing is written. Add --apply to make the changes.');
  const labEnv = readSettings(opts.envFile);
  const target = resolveTarget(labEnv, readSettings(credFile));
  const p1 = client(target, fetchImpl);
  const decisions = [];
  const apply = opts.apply;

  // a. the environment
  await p1.call('GET', '');
  log('a. environment: env found');

  // b. the agent app (made by pingone-real-setup.mjs): found BEFORE anything is written, so a missing app stops the run with the tenant untouched.
  const apps = await p1.list('/applications', 'applications');
  const byId = labEnv.AAG_AGENT_CLIENT_ID ? apps.filter((a) => String(a.id) === String(labEnv.AAG_AGENT_CLIENT_ID)) : [];
  const byName = apps.filter((a) => a.name === AGENT_APP_NAME);
  const agents = byId.length ? byId : byName;
  if (agents.length !== 1) throw new Error(agents.length ? `${agents.length} apps are named "${AGENT_APP_NAME}": delete the extras in the console, then run this again` : `the agent app "${AGENT_APP_NAME}" was not found. Run node scripts/owner/pingone-real-setup.mjs --apply first. Nothing was changed.`);
  const agent = agents[0];
  if (!plainId(agent)) throw new Error('the agent app id from PingOne is not a plain id; stopping before anything is written');
  log(`b. agent app "${AGENT_APP_NAME}": found`);

  // c. the tools resource, by its audience (never by id). Two with the audience, or the name on another audience, stop the run.
  const resources = await p1.list('/resources', 'resources');
  const withAud = resources.filter((r) => r.audience === TOOLS_AUDIENCE);
  if (withAud.length > 1) throw new Error(`${withAud.length} resources have the audience ${TOOLS_AUDIENCE}: the script does not guess which one the tool server uses. Remove the extras in the console. Nothing was changed.`);
  const sameName = resources.filter((r) => r.name === TOOLS_RESOURCE_NAME && r.audience !== TOOLS_AUDIENCE);
  if (sameName.length) throw new Error(`a resource named "${TOOLS_RESOURCE_NAME}" exists with another audience (${clip(sameName[0].audience || 'none')}). The tool server checks the audience ${TOOLS_AUDIENCE}: rename or remove it in the console. Nothing was changed.`);
  let res = withAud[0] || null;
  if (res) {
    if (!plainId(res)) throw new Error('the tools resource id from PingOne is not a plain id; stopping before anything is written');
    log(`c. resource "${res.name}" (audience ${TOOLS_AUDIENCE}): found, reused`);
    if (res.type !== 'CUSTOM') decisions.push(`The resource with the audience ${TOOLS_AUDIENCE} is of type ${clip(res.type)}, not CUSTOM: scopes and attributes may not be editable. Check it in the console.`);
    if (res.name !== TOOLS_RESOURCE_NAME) log(`   DRIFT (not changed): its name is "${clip(res.name)}", the lab calls it "${TOOLS_RESOURCE_NAME}"`);
  } else if (!apply) log(`c. resource "${TOOLS_RESOURCE_NAME}" (audience ${TOOLS_AUDIENCE}): would create (custom)`);
  else {
    res = await p1.call('POST', '/resources', TOOLS_RESOURCE);
    if (!plainId(res)) throw new Error('PingOne answered the resource create without a plain id; stopping');
    log(`c. resource "${TOOLS_RESOURCE_NAME}" (audience ${TOOLS_AUDIENCE}): created`);
  }

  // d. the six scopes
  const haveScopes = res ? await p1.list(`/resources/${res.id}/scopes`, 'scopes') : [];
  for (const sc of TOOLS_SCOPES) {
    if (haveScopes.some((x) => x.name === sc.name)) { log(`d. scope ${sc.name}: present`); continue; }
    if (!apply || !res) { log(`d. scope ${sc.name}: would create`); continue; }
    await p1.call('POST', `/resources/${res.id}/scopes`, sc);
    log(`d. scope ${sc.name}: created`);
  }

  // e. the two attributes: absent is created, present is reported and NEVER replaced
  const haveAttrs = res ? await p1.list(`/resources/${res.id}/attributes`, 'attributes') : [];
  for (const at of TOOLS_ATTRIBUTES) {
    const found = haveAttrs.filter((x) => x.name === at.name);
    if (found.length > 1) decisions.push(`The tools resource has ${found.length} attributes named ${at.name}: check them in the console (only the first is reported here).`);
    if (found[0]) {
      if (same(found[0].value, at.value)) log(`e. attribute ${at.name}: present, as expected (${clip(found[0].value)})`);
      else { log(`e. attribute ${at.name}: present but DIFFERENT (${clip(found[0].value)}); expected ${at.value}. Not changed: this script never replaces an attribute.`); decisions.push(`The ${at.name} attribute of the tools resource differs from the expected expression: check it in the console.`); }
      continue;
    }
    if (!apply || !res) { log(`e. attribute ${at.name}: would create (${at.value})`); continue; }
    await p1.call('POST', `/resources/${res.id}/attributes`, { name: at.name, value: at.value, type: 'CUSTOM' });
    log(`e. attribute ${at.name}: created (${at.value})`);
  }
  log('   UNVERIFIED: that the groups claim appears in an EXCHANGED token (only a client-credentials token was checked). Run the lab and read the delegated token\'s groups claim.');

  // f. the tier group (empty; the owner adds members)
  const groups = await p1.list(`/groups?filter=${encodeURIComponent(`name eq "${TIER_GROUP}"`)}`, 'groups');
  if (groups.length > 1) decisions.push(`${groups.length} groups are named ${TIER_GROUP}: check them in the console.`);
  if (groups.length) log(`f. group ${TIER_GROUP}: found, reused (its members are not touched)`);
  else if (!apply) log(`f. group ${TIER_GROUP}: would create (empty)`);
  else { await p1.call('POST', '/groups', TIER_GROUP_SPEC); log(`f. group ${TIER_GROUP}: created (empty)`); }

  // g. the agent app's grant of the six scopes on this one resource. The grant needs the scopes to exist, so a dry run before they do only says what it would do.
  const names = TOOLS_SCOPES.map((x) => x.name);
  const allExist = names.every((n) => haveScopes.some((x) => x.name === n)) || (apply && res);
  if (!res || !allExist) log(`g. grant to the agent app: would grant ${names.join(' ')} on "${TOOLS_RESOURCE_NAME}" (after the resource and scopes exist)`);
  else await ensureGrant(p1, agent.id, res, names, apply, (l) => log(`g.${l.slice(3)}`));

  // h. what the lab's .env may carry (nothing is written here)
  log('h. lab .env: this script writes nothing. The tool server\'s names are optional and these are the defaults, so set one only to change it:');
  for (const [k, v] of ENV_HINTS) log(`   ${k}=${v}`);
  log('   Optional, for a provider that is not the lab\'s own: AAG_TOOLS_SE_URL (an https MCP endpoint of a tool server that speaks the same wire format).');
  if (!apply) {
    for (const d of decisions) log(`OWNER DECISION: ${d}`);
    log('Dry run done. Nothing was changed. Rerun with --apply.');
    return { applied: false, decisions };
  }
  log(`OWNER STEP: add the users who should get the premium tier to the group ${TIER_GROUP} in the PingOne console, then sign out and sign in again in the lab.`);
  for (const d of decisions) log(`OWNER DECISION: ${d}`);
  return { applied: true, decisions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`refusing: ${e.message}`); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  run(opts).catch((e) => { console.error(`failed: ${e.message}`); process.exit(1); });
}
