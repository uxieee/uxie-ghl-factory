// bl-946 (DECISIONS 2026-11-09): the publish confirmation token. Pure module tests; the handler wiring is in publish-workflow.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuePublishToken, verifyPublishToken, outwardStepsOf, PUBLISH_TOKEN_TTL_MS } from '../core/publish-confirmation.mjs';
import { setPublishMinAgeForTests } from '../core/publish-confirmation.mjs';
// The older cases verify a token straight after issuing it; the minimum age is lowered for them. The w7 cases restore the default.
setPublishMinAgeForTests(0);

const base = { locationId: 'LOC', workflowId: 'WID', version: 3 };

test('a token issued for a preview verifies for the same location, workflow and version', () => {
  const token = issuePublishToken(base, { now: 1000 });
  assert.equal(typeof token, 'string');
  assert.deepEqual(verifyPublishToken(token, base, { now: 2000 }), { ok: true });
});

test('a token is refused for another workflow', () => {
  const token = issuePublishToken(base, { now: 1000 });
  const result = verifyPublishToken(token, { ...base, workflowId: 'OTHER' }, { now: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /workflow/);
});

test('a token is refused for another location', () => {
  const token = issuePublishToken(base, { now: 1000 });
  const result = verifyPublishToken(token, { ...base, locationId: 'OTHER' }, { now: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /location/);
});

test('a token is refused once the workflow version has moved', () => {
  const token = issuePublishToken(base, { now: 1000 });
  const result = verifyPublishToken(token, { ...base, version: 4 }, { now: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /version/);
});

test('a token is refused after its short lifetime', () => {
  const token = issuePublishToken(base, { now: 1000 });
  const result = verifyPublishToken(token, base, { now: 1000 + PUBLISH_TOKEN_TTL_MS + 1 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired/);
});

test('a token with an altered payload is refused on its signature', () => {
  const token = issuePublishToken(base, { now: 1000 });
  const [payload, sig] = token.slice('pc1-'.length).split('.');
  const forged = Buffer.from(JSON.stringify({ loc: 'LOC', wid: 'OTHER', ver: 3, exp: 9e15, jti: 'x' })).toString('hex');
  assert.notEqual(forged, payload);
  const result = verifyPublishToken(`pc1-${forged}.${sig}`, { ...base, workflowId: 'OTHER' }, { now: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /signature/);
});

test('a token is single use: the second verify is refused', () => {
  const token = issuePublishToken(base, { now: 1000 });
  assert.equal(verifyPublishToken(token, base, { now: 2000 }).ok, true);
  const again = verifyPublishToken(token, base, { now: 2001 });
  assert.equal(again.ok, false);
  assert.match(again.reason, /already used/);
});

test('garbage and empty tokens are refused', () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b.c']) {
    assert.equal(verifyPublishToken(bad, base, { now: 2000 }).ok, false, `refused: ${String(bad)}`);
  }
});

test('outwardStepsOf names the steps that send something, and no internal step', () => {
  const templates = [
    { id: 'a', type: 'email', name: 'Welcome email' },
    { id: 'b', type: 'add_contact_tag', name: 'Tag it' },
    { id: 'c', type: 'send_sms', name: 'Text the lead' },
    { id: 'd', type: 'webhook', name: 'Notify CRM' },
  ];
  assert.deepEqual(outwardStepsOf(templates).map((s) => s.name), ['Welcome email', 'Text the lead', 'Notify CRM']);
});

test('a token issued for a studio site is refused for a workflow publish, and the reverse', () => {
  const studio = issuePublishToken({ locationId: 'LOC', workflowId: 'P1', version: 'V1', kind: 'studio_site' }, { now: 1000 });
  const asWorkflow = verifyPublishToken(studio, { locationId: 'LOC', workflowId: 'P1', version: 'V1' }, { now: 2000 });
  assert.equal(asWorkflow.ok, false);
  assert.match(asWorkflow.reason, /different kind/);
  const workflow = issuePublishToken({ locationId: 'LOC', workflowId: 'P1', version: 'V1' }, { now: 1000 });
  const asStudio = verifyPublishToken(workflow, { locationId: 'LOC', workflowId: 'P1', version: 'V1', kind: 'studio_site' }, { now: 2000 });
  assert.equal(asStudio.ok, false);
  assert.match(asStudio.reason, /different kind/);
  assert.deepEqual(verifyPublishToken(studio, { locationId: 'LOC', workflowId: 'P1', version: 'V1', kind: 'studio_site' }, { now: 2000 }), { ok: true });
});

// w7 (orchestrator 2026-11-09, DECISIONS): an agent re-run showed the model takes the preview's token and publishes in the same
// turn with no user reply. The token is now valid only from 20 s after its preview, to the 5-minute expiry. A same-turn call is
// refused with a message to show the preview and wait for the user's yes; the refusal spends nothing.
import { PUBLISH_MIN_AGE_MS } from '../core/publish-confirmation.mjs';

test('w7: a token presented in the same moment as its preview is refused, the refusal says to wait for the user, and the token is not spent', () => {
  setPublishMinAgeForTests(PUBLISH_MIN_AGE_MS);
  const token = issuePublishToken(base, { now: 1000 });
  const early = verifyPublishToken(token, base, { now: 2000 });
  assert.equal(early.ok, false);
  assert.match(early.reason, /show the preview to the user \(in an orchestrated build, the orchestrator session\) and wait for their yes/);
  // not spent by the refusal: the same token works once the minimum age has passed
  assert.deepEqual(verifyPublishToken(token, base, { now: 1000 + PUBLISH_MIN_AGE_MS }), { ok: true });
});

test('w7: the minimum age is 20 seconds, exactly: 19.999 s refused, 20 s accepted', () => {
  setPublishMinAgeForTests(PUBLISH_MIN_AGE_MS);
  assert.equal(PUBLISH_MIN_AGE_MS, 20 * 1000);
  const token = issuePublishToken(base, { now: 5000 });
  assert.equal(verifyPublishToken(token, base, { now: 5000 + 19999 }).ok, false);
  assert.deepEqual(verifyPublishToken(token, base, { now: 5000 + 20000 }), { ok: true });
});

test('w7: the 5-minute expiry is unchanged, and a token past it is refused as expired', () => {
  setPublishMinAgeForTests(PUBLISH_MIN_AGE_MS);
  const token = issuePublishToken(base, { now: 0 });
  const late = verifyPublishToken(token, base, { now: PUBLISH_TOKEN_TTL_MS + 1 });
  assert.equal(late.ok, false);
  assert.match(late.reason, /expired/);
});

test('w7: the minimum age does not weaken the other checks (a wrong workflow is still refused, after the age has passed)', () => {
  setPublishMinAgeForTests(PUBLISH_MIN_AGE_MS);
  const token = issuePublishToken(base, { now: 0 });
  assert.match(verifyPublishToken(token, { ...base, workflowId: 'OTHER' }, { now: PUBLISH_MIN_AGE_MS }).reason, /another workflow/);
});
