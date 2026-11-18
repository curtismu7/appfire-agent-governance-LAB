// The airline hand-off use cases (the bookings specialist) read the traveller's bookings, not the group-gated passenger record (owner 2026-11-18: a group-less user was
// PERMITted the sensitive record "no rule restricts this call" in the hand-off while the group check refused the same tool). Engine only; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, withServer, W } from './helpers.js';

const toolOfDecision = (r) => {
  const h = (r.hops || []).find((x) => x.kind === 'authorize-decision');
  return { tool: h?.request?.body?.action ?? h?.request?.body?.tool ?? null, body: h?.request?.body ?? null, answer: h?.response?.body ?? null };
};

test('the airline hand-off runs (specialist, delegation, unregistered agent) ask the policy about the booking read tool, never the group-gated record', async () => {
  await withServer(async (url) => {
    for (const id of ['UC2', 'UC2.5', 'UC2.6']) {
      const r = await run(url, id, { vertical: 'airline', persona: 'standard' }, W('w-aaaaaaaaaaaaaaaa'));
      assert.equal(r.status, 200, id);
      const d = toolOfDecision(r.body.run);
      assert.equal(d.tool, 'get_airline_bookings', `${id}: the hand-off reads the traveller's bookings`);
      assert.notEqual(d.tool, 'sensitive_passenger_record', id);
      assert.equal(d.answer?.decision, 'PERMIT', id);
    }
  });
});

test('the group check still refuses the passenger record for a user with no group, and permits it for the premium traveller', async () => {
  await withServer(async (url) => {
    const std = (await run(url, 'UC9', { vertical: 'airline', persona: 'standard' }, W('w-bbbbbbbbbbbbbbbb'))).body.run;
    assert.equal(std.outcome, 'DENY_403');
    assert.equal(toolOfDecision(std).tool, 'sensitive_passenger_record');
    assert.match(toolOfDecision(std).answer?.reason ?? '', /group policy/);
    const prem = (await run(url, 'UC9', { vertical: 'airline', persona: 'premium' }, W('w-cccccccccccccccc'))).body.run;
    assert.notEqual(prem.outcome, 'DENY_403');
  });
});
