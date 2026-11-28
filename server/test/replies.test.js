import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST, findUseCase } from '../src/manifest.js';
import { VERTICALS, PERSONAS, loadCast, toolFor, unfilled } from '../src/cast.js';
import { runUseCase } from '../src/flow.js';
import { REPLIES, proposalFor, replyFor, templateFor, valuesFor } from '../src/replies.js';
import { SITUATIONS } from '../src/situations.js';

const run = (id, vertical = 'banking', persona = 'standard') => runUseCase(findUseCase(id), { cast: loadCast(null, vertical), vertical, persona, seed: 't' });
const kindBody = (r, kind) => r.hops.find((h) => h.kind === kind && h.verdict !== 'skip')?.response?.body;
const replyOf = (r) => kindBody(r, 'agent-reply')?.reply;

// Every tool a vertical can run: the catalog's primary tools swapped for the vertical's own (toolFor), plus the everyday read tool used when a
// use case names none.
const toolsOf = (cast) => new Set([cast.castReadTool, ...MANIFEST.usecases.filter((u) => u.primaryTool).map((u) => toolFor(cast, u.primaryTool))]);

test('every tool used by any vertical has a reply template, and every {{name}} in it is filled for both personas', () => {
  for (const [v, cast] of Object.entries(VERTICALS)) {
    for (const tool of toolsOf(cast)) {
      const t = templateFor(v, tool);
      assert.equal(typeof t, 'string', `${v} ${tool}: no reply template`);
      for (const persona of PERSONAS) {
        const values = valuesFor({ cast, vertical: v, persona, tool, amount: 600, args: {} });
        assert.deepEqual(unfilled(t, values), [], `${v} ${tool} ${persona}`);
        const said = replyFor({ cast, vertical: v, persona, tool, amount: 600 });
        assert.doesNotMatch(said, /mock result|\{\{|undefined|null/, `${v} ${tool} ${persona}: ${said}`);
        assert.ok(!said.includes(tool), `${v} ${tool}: the reply does not name the tool`);
      }
    }
    for (const t of Object.values(REPLIES.proposals[v] || {})) assert.deepEqual(unfilled(t, valuesFor({ cast, vertical: v, persona: 'standard' })), [], `${v} proposal`);
  }
  for (const t of [REPLIES.fallback, REPLIES.proposalFallback]) assert.deepEqual(unfilled(t, valuesFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard' })), []);
});

test('an unknown tool gets the generic sentence, never "mock result of <tool>"', () => {
  const said = replyFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'no_such_tool' });
  assert.equal(said, 'Done: I checked your account and everything is in order.');
  assert.equal(proposalFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'no_such_tool' }), 'I have this request ready to go.');
  assert.equal(templateFor('banking', '__proto__'), null);
  assert.equal(templateFor('__proto__', 'get_account_balance'), null);
});

test('the engine replies read like a real agent, with lab-invented amounts, deterministic per vertical and persona', () => {
  assert.equal(replyOf(run('UC1')), 'Your checking balance is $4,250.00, and your savings balance is $12,800.00.');
  assert.equal(replyOf(run('UC1', 'banking', 'premium')), 'Your checking balance is $18,940.00, and your savings balance is $52,300.00.');
  assert.equal(replyOf(run('UC33')), 'Your mortgage balance is $312,450.00 at 5.25% fixed. Your next payment of $1,985.00 is due December 1.');
  assert.equal(replyOf(run('UC2')), 'Your portfolio is worth $86,300.00, up 2.4% this month, split 60% stocks, 30% bonds and 10% cash.');
  assert.equal(replyOf(run('UC22')), `Done: $${SITUATIONS.UC22.amount} moved from checking to savings.`);
  assert.match(replyOf(run('UC2.6')), /^Your portfolio is worth \$86,300\.00.* A different agent then tried the same call for you and was refused/);
  assert.equal(replyOf(run('UC1', 'healthcare')), 'You are on the Silver PPO plan: $640.00 of your $2,000.00 deductible is met, and you pay 20% coinsurance after that.');
  assert.equal(replyOf(run('UC33', 'retail')), 'Your gift card balance is $75.00, and you have $320.00 in store credit.');
  assert.equal(replyOf(run('UC1')), replyOf(run('UC1')), 'repeats exactly');
});

test('a held transfer says what the agent is ready to do with the amount; the refusal text is unchanged', () => {
  const held = run('UC7');
  assert.equal(held.outcome, 'STEP_UP');
  assert.equal(kindBody(held, 'tool-held').proposed, 'I\'m ready to move $600 from checking to savings.');
  assert.equal(replyOf(held), undefined, 'a held run has no agent reply');
  const denied = run('UC6');
  assert.equal(denied.outcome, 'DENY');
  assert.equal(kindBody(denied, 'tool-refused').reason, 'amount 2500 is in the DENY band (lab-invented threshold 2000)');
});

test('no run in any full vertical or persona says "mock result of" or leaves a {{name}} in a reply, proposal or tool result', () => {
  for (const v of Object.keys(VERTICALS)) for (const persona of PERSONAS) for (const uc of MANIFEST.usecases) {
    const r = runUseCase(uc, { cast: loadCast(null, v), vertical: v, persona, seed: 't' });
    for (const h of r.hops) {
      const s = JSON.stringify(h.response?.body ?? '');
      assert.doesNotMatch(s, /mock result of|\{\{/, `${v} ${persona} ${uc.id} ${h.kind}`);
    }
  }
});

// ---- the software pack (AeroGuard Work Suite) ----
const BANKING_WORDS = /\b(balance|transfer|checking|savings|mortgage|bank(ing)?|deposit|portfolio|branch(es)?|fee waiver|credit|account|accounts)\b|\$/i;
const SW_TOOLS = ['get_my_issues', 'bulk_update_issues', 'get_project_security_settings', 'get_release_summary', 'list_marketplace_apps', 'get_deployment_status', 'request_admin_access', 'scan_repository'];

test('software: every tool its use cases run resolves per role and has its own reply, for both personas', () => {
  const tools = toolsOf(VERTICALS.software);
  for (const t of SW_TOOLS) assert.ok(tools.has(t), `${t} is a software tool`);
  for (const t of tools) assert.equal(typeof REPLIES.replies.software[t] ?? REPLIES.replies.shared[t], 'string', t);
  for (const t of SW_TOOLS) assert.equal(typeof REPLIES.replies.software[t], 'string', `${t} has a software template, not a shared one`);
  for (const persona of PERSONAS) for (const t of tools) {
    const said = replyFor({ cast: VERTICALS.software, vertical: 'software', persona, tool: t, amount: 600 });
    assert.doesNotMatch(said, BANKING_WORDS, `${persona} ${t}: ${said}`);
  }
  assert.equal(proposalFor({ cast: VERTICALS.software, vertical: 'software', persona: 'standard', tool: 'bulk_update_issues', amount: 600 }), "I'm ready to move 600 issues in the Billing project to Done.");
});

test('software: the amount prints as "600 issues", never "$600"; the other packs keep dollars', () => {
  for (const persona of PERSONAS) {
    const r = run('UC22', 'software', persona);
    assert.equal(replyOf(r), 'Done: 150 issues in the Billing project moved to Done.');
    assert.equal(kindBody(run('UC7', 'software', persona), 'tool-held').proposed, "I'm ready to move 600 issues in the Billing project to Done.");
    assert.equal(kindBody(run('UC8', 'software', persona), 'tool-held').proposed, "I'm ready to move 300 issues in the Billing project to Done.");
  }
  assert.doesNotMatch(JSON.stringify(run('UC7', 'software').hops.map((h) => h.response?.body)), /\$600/);
  assert.equal(replyFor({ cast: VERTICALS.software, vertical: 'software', persona: 'standard', tool: 'bulk_update_issues', amount: 1 }), 'Done: 1 issue in the Billing project moved to Done.');
  assert.equal(replyFor({ cast: VERTICALS.software, vertical: 'software', persona: 'standard', tool: 'bulk_update_issues' }), 'Done: 25 issues in the Billing project moved to Done.', 'no run amount: the pack default');
  assert.equal(replyFor({ cast: VERTICALS.banking, vertical: 'banking', persona: 'standard', tool: 'create_transfer', amount: 600 }), 'Done: $600 moved from checking to savings.');
  assert.equal(replyFor({ cast: VERTICALS.retail, vertical: 'retail', persona: 'standard', tool: 'checkout', amount: 85.5 }), 'Done: your $85.50 order is placed and paid with store credit.');
});

test('software: the replies for the use cases the walkthrough runs, both personas, with lab-invented values', () => {
  assert.equal(replyOf(run('UC1', 'software')), 'You have 7 open issues assigned to you, 2 due this week; the top one is PLAT-412, Fix login timeout on the billing page.');
  assert.equal(replyOf(run('UC1', 'software', 'premium')), 'You have 12 open issues assigned to you, 4 due this week; the top one is PLAT-377, Upgrade the build runner image.');
  assert.equal(replyOf(run('UC33', 'software')), 'Your last deployment, release 4.18.2 to production, finished at 10:42 am with all 126 checks green, and no rollback is pending.');
  assert.equal(replyOf(run('UC21', 'software', 'premium')), 'The Billing project is restricted: 22 members, 4 admins and 6 deploy keys that stay masked here. Full details are in project settings.');
  assert.equal(replyOf(run('UC24', 'software')), 'I found 12 public Marketplace apps for Jira Cloud; the closest match for workflow automation is JSU Automation Suite.');
  assert.equal(replyOf(run('UC2', 'software')), "Release 4.18 has 38 issues, 31 merged pull requests and 2 open blockers, and it is on track for Thursday's deployment.");
  assert.match(replyOf(run('UC2.6', 'software')), /^Release 4\.18 has 38 issues.* A different agent then tried the same call for you and was refused/);
  assert.equal(replyOf(run('UC28', 'software')), "I've filed request ADM-231 for site admin access on your Jira site. I can't grant it myself; a Jira admin will review it.");
  assert.equal(replyOf(run('UC30', 'software')), 'The code scanner checked 212 dependencies in the platform repository and found 9 findings, 1 of them high severity.');
  assert.equal(replyOf(run('UC41', 'software')), 'I found three recent pages on "Jira workflow automation best practices"; the newest one is from this morning.');
  assert.equal(kindBody(run('UC9', 'software'), 'tool-refused').reason, 'group policy: the user is not a member of the required group');
});

// "checking" as a verb (the generic RFC failure-mode text on the step detail: "Checking the signature...", "Checking only the outermost actor") is not the account.
const BANKING = /\b(balance|transfers?|checking(?! (the|policy|its|only)\b)|savings|mortgage|bank(ing)?|deposit|portfolio|branch(es)?|fee waiver|credit)\b|\$\d/i;
test('software: nothing in any run, whatever the persona, says a banking word or a dollar amount: every hop, the narration, the title and the prompt', () => {
  for (const persona of PERSONAS) for (const uc of MANIFEST.usecases) {
    const r = runUseCase(uc, { cast: loadCast(null, 'software'), vertical: 'software', persona, seed: 't' });
    const s = JSON.stringify(r);
    assert.doesNotMatch(s, BANKING, `${persona} ${uc.id}: ${s.match(new RegExp(`.{0,60}${BANKING.source}.{0,60}`, 'i'))?.[0]}`);
  }
});

test('software: the use case reaches the run in the vertical\'s own words, and the same use case in banking keeps the catalog words', () => {
  assert.equal(run('UC33', 'software').useCase.title, 'Deployment status');
  assert.match(run('UC33', 'software').narration, /"Deployment status"/);
  const prompt = (r) => r.hops.find((h) => h.kind === 'prompt').request.body.message;
  assert.equal(prompt(run('UC1', 'software')), 'show my open issues');
  assert.equal(prompt(run('UC7', 'software')), 'bulk-edit 600 issues in the Billing project and move them to Done');
  assert.equal(prompt(run('UC3', 'software')), 'show my open issues', 'a use case with no prompt of its own and the catalog read chip shows the pack read prompt');
  assert.equal(run('UC33', 'banking').useCase.title, 'My mortgage');
  assert.equal(prompt(run('UC7', 'banking')), 'transfer $600 from checking to savings');
  assert.equal(prompt(run('UC24', 'healthcare')), 'What branches are near me?');
});

test('banking, healthcare and retail replies and tool names are unchanged by the software pack', () => {
  for (const v of ['banking', 'healthcare', 'retail']) for (const t of ['get_branch_hours', 'show_mortgage', 'request_fee_waiver', 'get_weather']) assert.equal(toolFor(VERTICALS[v], t), t);
  assert.equal(replyOf(run('UC24')), 'The nearest branch, Main Street, is open 9 am to 5 pm on weekdays and 9 am to 1 pm on Saturdays.');
  assert.equal(replyOf(run('UC28')), 'Done: the $15.00 monthly maintenance fee on your checking account is waived this month.');
  assert.equal(replyOf(run('UC30')), 'The outlook for TX is partly cloudy, with a high of 74°F and a 20% chance of rain.');
  assert.equal(replyOf(run('UC21', 'healthcare', 'premium')), 'Your records are on file: blood type A-, allergies to peanuts, last visit November 2. Full records stay in the patient portal.');
  assert.equal(kindBody(run('UC8', 'retail'), 'tool-held').proposed, "I'm ready to check out $300 with store credit.");
  assert.equal(kindBody(run('UC8', 'healthcare'), 'tool-held').proposed, "I'm ready to pay $300 toward your patient bill.");
});
