// Builds content-pack.json for the Learning Hub from the story data and the manifest, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
// The pack uses .invalid placeholders and no documentation URLs. No catalog id yet: the owner assigns one with the board row.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST, DEFAULT_VERTICAL } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';
import { MANIFEST, TRACKS } from '../server/src/manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NOTE = 'The use case is from the AI-DEMO2 catalog; the amounts and events are lab-invented.';

const TRACK_BLURB = {
  foundations: 'Delegation basics: consent, token exchange with an act claim, A2A delegation, personal and workload agents.',
  learn: 'Guided learning pages. The lab lists them and links out to a sibling standalone where one covers the same thing (lab reading).',
  controls: 'Policy controls: authorization denies, group and tier checks, third-party servers scoped at the gateway, enterprise-managed MCP.',
  hitl: 'Step-up, human approval and CIBA for risky writes.',
  demo: 'Presenter guides and sign-in flows.',
  attacks: 'Eleven attacks and the refusal each one ends in.',
  tools: 'Protected tools and agent-to-agent access review.',
  nhi: 'Non-human identity: the source-tagged roster and the joiner-mover-leaver feed.',
};

export function buildPack() {
  const story = buildStory(DEFAULT_CAST, DEFAULT_VERTICAL);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const tracks = Object.keys(TRACKS);
  const why = story.talkTrack.find((t) => t.id === 'why-appfire-agent-governance').say;
  return {
    schema: 'demo-content-pack/1',
    id: 'appfire-agent-governance-lab',
    title: 'Appfire Agent Governance LAB',
    version,
    demo: { id: 'appfire-agent-governance-lab', name: 'Appfire Agent Governance LAB', catalog: 'D000', baseUrl: 'http://localhost:7814', doctor: '/api/health', tags: ['appfire-agent-governance', 'token-exchange', 'act-claim', 'authorize', 'gateway', 'step-up', 'hitl', 'ciba', 'attacks'] },
    glossary: [
      { id: 'appfire-agent-governance', term: 'Customer-facing agent', definition: `An AI agent that acts for a customer: it asks for a list of trips, a flight booking, a flight status. ${NOTE}`, aliases: ['customer agent'] },
      { id: 'delegation', term: 'Delegation with an act claim', definition: `RFC 8693 token exchange mints a delegated token whose sub is the customer and whose act claim names the agent. Delegation, not impersonation. ${NOTE}`, aliases: ['act claim', 'on behalf of'] },
      { id: 'consent', term: 'Consent (may_act)', definition: `The customer lets a named agent act for them before the exchange. ${NOTE}`, aliases: ['may_act'] },
      { id: 'constrained-booking', term: 'Constrained booking', definition: `A permitted call whose arguments the rule narrows (here the cabin, business to economy). The outcome word CONSTRAINED is the lab's own: the lab's fare rule decides it, not a PingOne Authorize outcome. The two fare limits and the international flag are lab-invented. ${NOTE}`, aliases: ['allowed with a limit', 'narrowed booking'] },
      { id: 'authorize-decision', term: 'Authorize decision', definition: `A policy decision on every call: PERMIT, DENY, or an obligation (step-up, human approval, CIBA). The airline pack adds one outcome of the lab's own, CONSTRAINED. The lab's thresholds are lab-invented, fitted to the catalog's example amounts. ${NOTE}`, aliases: ['PDP'] },
      { id: 'step-up-hitl', term: 'Step-up and human approval', definition: `A risky write returns an obligation instead of running: a second factor first, or a verified human approval receipt. A boolean "approved" flag from the client does not count. ${NOTE}`, aliases: ['HITL', 'step up'] },
      { id: 'ciba', term: 'CIBA out-of-band approval', definition: `The agent asks the identity provider to authenticate the customer on another device and polls until they approve. Needs a feature flag; the lab runs it on its own steps here. ${NOTE}`, aliases: ['back-channel authentication'] },
      { id: 'gateway-check', term: 'Gateway check', definition: `The gateway validates signature, audience, expiry, act claim and scope, applies rate limits and edge policy, and fails closed. ${NOTE}`, aliases: ['agent gateway'] },
      { id: 'a2a-chain', term: 'A2A delegation chain', definition: `A nested act claim when one agent hands work to another: scope is narrowed at each hop and an unregistered agent in the chain is denied. ${NOTE}`, aliases: ['nested act'] },
      { id: 'idp-only-path', term: 'Identity-provider-only path', definition: 'On this path (the owner\'s opt-in) a run makes two real calls to one PingOne environment: its discovery document and the agent\'s own client-credentials token (shown masked). It runs nothing else: no customer sign-in, token exchange, gateway check, policy decision or tool call, and it lists the steps it did not run. The path has not been run against a real tenant by the builder: UNVERIFIED.', aliases: ['identity provider only'] },
      { id: 'lab-tokens', term: 'Lab-issued tokens', definition: 'Tokens in this lab are issued by the lab and signed ES256 with a public key. They protect nothing and are shown raw for education.', aliases: [] },
    ],
    sources: [
      { id: 'catalog', title: `AI-DEMO2 use-case catalog, commit ${String(MANIFEST.source.commit).slice(0, 9)} (read only)`, url: 'https://example.invalid/ai-demo2-use-case-catalog', kind: 'catalog', use: 'The 87 use cases, their tracks, stories, triggers, expected outcomes and evidence chains.', status: 'read', checked: '2026-10-31' },
    ],
    cards: [
      ...tracks.map((t, i) => ({ id: `try-${t}`, label: `${t[0].toUpperCase()}${t.slice(1)} track (${TRACKS[t]} use cases)`, description: `${TRACK_BLURB[t]} ${NOTE}`, group: 'try-it', action: { type: 'route', href: `/#track-${t}` }, terms: ['appfire-agent-governance'], story: sid(i + 1) })),
      { id: 'try-delegation', label: 'Run delegated access (UC1)', description: 'Sign in as the demo customer, consent, exchange, gateway check, authorize, dispatch: seven hops, each with its raw request and response.', group: 'try-it', action: { type: 'route', href: '/#run-UC1' }, terms: ['delegation', 'consent', 'gateway-check'] },
      { id: 'try-constrained', label: 'Run the international booking next to the domestic one', description: 'Run the international booking next to the domestic one: same fare, the second is booked in economy. The agent asked for business and the answer says what was narrowed. The limits and the flag are lab-invented.', group: 'try-it', action: { type: 'route', href: '/#run-UC8' }, terms: ['constrained-booking', 'authorize-decision'] },
      { id: 'try-step-up', label: 'Run the booking over the higher limit', description: 'A booking over the second limit returns an approval obligation and the write is held until a person approves. Thresholds are lab-invented.', group: 'try-it', action: { type: 'route', href: '/#run-UC6' }, terms: ['authorize-decision', 'step-up-hitl'] },
      { id: 'try-replay', label: 'Run the DPoP replay attack (UC12)', description: 'The first proof is accepted and the replay is refused with 401. Needs the feature ff_dpop; the lab runs it on its own steps here.', group: 'try-it', action: { type: 'route', href: '/#run-UC12' }, terms: ['gateway-check'] },
      { id: 'concept-why-appfire-agent-governance', label: 'Why it matters: a customer-facing agent that cannot overreach', description: why, group: 'concept', action: { type: 'route', href: '/#talk' }, terms: ['appfire-agent-governance', 'delegation', 'authorize-decision'] },
      { id: 'concept-idp-only-path', label: 'The identity-provider-only path', description: 'It reaches the identity provider only and lists what it did not run. UNVERIFIED on a real tenant.', group: 'concept', action: { type: 'route', href: '/#talk' }, terms: ['idp-only-path'] },
      { id: 'concept-lab-tokens', label: 'Lab-issued tokens', description: 'Every token is signed with a public key and shown raw with its decoded claims.', group: 'concept', action: { type: 'route', href: '/#tokens' }, terms: ['lab-tokens'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: tracks.map((t, i) => ({ id: sid(i + 1), title: `${t[0].toUpperCase()}${t.slice(1)} track`, say: `${TRACK_BLURB[t]} ${TRACKS[t]} use cases.` })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
