// w6c-9 (plan Task 9, bl-789): POST /workflow/{loc}/test-workflow/{wf} runs every step for real against the chosen contact, with no dry
// run. It is a send-class call: the raw route needs an acknowledgement (requireSendAck). RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendClassFor, requireSendAck } from '../core/send-class.mjs';
import { CODES } from '../core/errors.mjs';

const LOC = 'TEST_LOCATION_ID';
const WF = 'TEST_WORKFLOW_ID';

test('POST test-workflow is classified send (rule test-run) with its consequence', () => {
  const c = sendClassFor('POST', `/workflow/${LOC}/test-workflow/${WF}`, { eventId: 'e1' });
  assert.ok(c, 'not null');
  assert.equal(c.class, 'send');
  assert.equal(c.rule, 'test-run');
  assert.match(c.consequence, /every step for real against the chosen contact/);
  assert.match(c.consequence, /no dry run/);
});

test('the same route with a trailing slash or an encoded segment is classified the same', () => {
  const base = sendClassFor('POST', `/workflow/${LOC}/test-workflow/${WF}`, {});
  assert.deepEqual(sendClassFor('POST', `/workflow/${LOC}/test-workflow/${WF}/`, {}), base);
  assert.deepEqual(sendClassFor('POST', `/workflow/${LOC}/test-workflow/${encodeURIComponent(WF)}`, {}), base);
});

test('a GET on the test-workflow route is not a send (reads are not gated)', () => {
  assert.equal(sendClassFor('GET', `/workflow/${LOC}/test-workflow/${WF}/event-runs`, undefined), null);
});

test('the test-run send is refused without an acknowledgement (requireSendAck)', () => {
  const sc = sendClassFor('POST', `/workflow/${LOC}/test-workflow/${WF}`, {});
  const res = requireSendAck({}, sc, { method: 'POST', path: `/workflow/${LOC}/test-workflow/${WF}`, wireBody: {} });
  assert.ok(res && res.ok === false, 'refused');
});

test('TEST_RUN_SENDS is a stable error code', () => {
  assert.equal(CODES.TEST_RUN_SENDS, 'TEST_RUN_SENDS');
});

// Security review (2026-11-07): the test-run rule covered only the bare POST. Every non-GET under /workflow/{loc}/test-workflow/ must be a
// send (fail closed): test-action runs one step for real, the run routes act on a live run, and stop and preview are not read-only by default.
test('every non-GET under test-workflow is classified send (sibling routes, fail closed)', () => {
  const base = `/workflow/${LOC}/test-workflow/${WF}`;
  for (const [method, path] of [
    ['POST', `${base}/test-action`],
    ['POST', `/workflow/${LOC}/test-workflow/runs/run-1/stop`],
    ['POST', `/workflow/${LOC}/test-workflow/runs/run-1/custom-var-preview`],
  ]) {
    const c = sendClassFor(method, path, {});
    assert.ok(c, `${method} ${path} is classified`);
    assert.equal(c.class, 'send', path);
  }
});

test('a GET under test-workflow is still not a send', () => {
  assert.equal(sendClassFor('GET', `/workflow/${LOC}/test-workflow/runs/run-1/step-events`, undefined), null);
});
