// bl-1021 (2026-11-10, w9-wf2): the live conformance suite sent publish_workflow, copy_workflow_to_location and edit_workflow writes
// as one call with confirm:true, so the two-step gate (preview, wait at least 20 s, confirm with the token) returned CONFIRM_REQUIRED and
// the write legs never ran (run 2149: 7 publish, 3 copy, 1 edit stopped). twoStep is the suite's one way to drive that gate. These tests
// pin its contract before the suite is wired to it (RED first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoStep, TWO_STEP_WAIT_MS } from '../../skills/create-ghl-workflow/scripts/two-step.mjs';

// A fake gateway: each call is recorded with the simulated clock, and sleep advances the clock.
function harness(responses) {
  let clock = 1_000_000;
  const calls = [];
  const call = async (name, args) => {
    calls.push({ name, args: structuredClone(args), at: clock });
    const next = responses.shift();
    return typeof next === 'function' ? next(args) : next;
  };
  const sleep = async (ms) => { clock += ms; };
  return { call, sleep, calls };
}

test('bl-1021: the suite waits at least 20 s between the preview and the confirm', () => {
  assert.ok(TWO_STEP_WAIT_MS >= 20_000, `TWO_STEP_WAIT_MS is ${TWO_STEP_WAIT_MS}; the publish gate needs at least 20 s`);
});

test('bl-1021: preview (no confirm), wait, then confirm once with the token', async () => {
  const token = 'pc1-token-from-preview';
  const h = harness([
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { step: 'publish' }, confirmationToken: token } },
    { ok: true, code: undefined, data: { published: true } },
  ]);
  const out = await twoStep(h.call, 'publish_workflow', { workflowId: 'WID' }, { sleep: h.sleep });
  assert.equal(h.calls.length, 2, 'exactly one preview and one confirm');
  assert.equal(h.calls[0].args.confirm, undefined, 'the preview sends no confirm');
  assert.equal(h.calls[1].args.confirm, true, 'the confirm sends confirm:true');
  assert.equal(h.calls[1].args.confirmationToken, token, 'the confirm presents the token the preview issued');
  assert.ok(h.calls[1].at - h.calls[0].at >= 20_000, `the confirm came ${h.calls[1].at - h.calls[0].at} ms after the preview`);
  assert.equal(out.final.data.published, true, 'the final result is the confirm result');
  assert.equal(out.waited, TWO_STEP_WAIT_MS);
});

test('bl-1021: a tool that returns no token after the preview is not confirmed again', async () => {
  const h = harness([{ ok: true, data: { previewed: false, note: 'not gated' } }]);
  const out = await twoStep(h.call, 'some_tool', { workflowId: 'WID' }, { sleep: h.sleep });
  assert.equal(h.calls.length, 1, 'no second call when the first result carries no token');
  assert.equal(out.waited, 0);
  assert.equal(out.final, out.preview);
});

test('bl-1021: an edit-style previewToken is confirmed at once, without the publish wait', async () => {
  const previewToken = { version: 4, fingerprint: 'fp' };
  const h = harness([
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: {}, previewToken } },
    { ok: true, data: { edited: true } },
  ]);
  const out = await twoStep(h.call, 'edit_workflow', { workflowId: 'WID', ops: [] }, { sleep: h.sleep });
  assert.equal(h.calls[1].args.confirm, true);
  assert.deepEqual(h.calls[1].args.previewToken, previewToken, 'the confirm presents the previewToken');
  assert.equal(h.calls[1].at - h.calls[0].at, 0, 'no wait for a previewToken');
  assert.equal(out.waited, 0);
  assert.equal(out.final.data.edited, true);
});

test('bl-1021: a preview refusal (no token) is returned as is', async () => {
  const h = harness([{ ok: false, code: 'VALIDATION_FAILED', detail: 'refused' }]);
  const out = await twoStep(h.call, 'publish_workflow', { workflowId: 'WID' }, { sleep: h.sleep });
  assert.equal(h.calls.length, 1);
  assert.equal(out.final.code, 'VALIDATION_FAILED');
});

// The wiring: the suite's three write legs (publish, the rename edit, the copy) must go through twoStep, not one confirm:true call.
test('bl-1021: the publish, rename-edit and copy legs go through twoStep, not one confirm:true call', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../skills/create-ghl-workflow/scripts/', import.meta.url);
  const conf = readFileSync(new URL('conformance.mjs', dir), 'utf8');
  const copy = readFileSync(new URL('copy-workflow-proof.mjs', dir), 'utf8');
  assert.ok(!conf.includes("call('publish_workflow', { workflowId: wid, confirm: true })"), 'publish leg still sends one confirm:true call');
  assert.ok(conf.includes("twoStep(call, 'publish_workflow'"), 'publish leg does not use twoStep');
  assert.ok(!conf.includes("call('edit_workflow', { workflowId: wid, confirm: true, acknowledgeDrift: true, ops: [{ op: 'updateSettings'"), 'rename edit leg still sends one confirm:true call');
  assert.ok(conf.includes("twoStep(call, 'edit_workflow'"), 'rename edit leg does not use twoStep');
  assert.ok(!copy.includes("'copy_workflow_to_location', { workflowId: wid, targetLocationId: LOCATION, confirm: true }"), 'copy leg still sends one confirm:true call');
  assert.ok(copy.includes('twoStep('), 'copy leg does not use twoStep');
});

// The live edit preview nests its token under data.preview (core/tools.mjs: the preview object carries previewToken).
test('bl-1021: an edit preview token nested under data.preview is confirmed at once', async () => {
  const previewToken = { version: 4, fingerprint: 'fp-nested' };
  const h = harness([
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { previewToken } } },
    { ok: true, data: { edited: true } },
  ]);
  const out = await twoStep(h.call, 'edit_workflow', { workflowId: 'WID', ops: [] }, { sleep: h.sleep });
  assert.equal(h.calls.length, 2, 'the nested previewToken must be confirmed, not returned as a preview');
  assert.equal(h.calls[1].args.confirm, true);
  assert.deepEqual(h.calls[1].args.previewToken, previewToken);
  assert.equal(out.final.data.edited, true);
});

// Every publish_workflow write in the create-ghl-workflow scripts goes through the two-step gate, not one confirm:true call.
test('bl-1021: no create-ghl-workflow script publishes with a single confirm:true call', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../../skills/create-ghl-workflow/scripts/', import.meta.url);
  const single = /'publish_workflow', \{ workflowId: \w+, confirm: true \}/;
  const offenders = readdirSync(dir).filter((f) => f.endsWith('.mjs')).filter((f) => single.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(offenders, [], `single-call publish left in: ${offenders.join(', ')}`);
});

// fast_forward_contacts gates on the two-step confirmationToken (with the 20 s wait) AND its roster previewToken: both on the confirm.
test('bl-1021: a confirmationToken gate that also needs the roster previewToken gets both, after the wait', async () => {
  const h = harness([
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { count: 1, previewToken: 'roster-1' }, confirmationToken: 'tok-ff' } },
    { ok: true, data: { moved: 1 } },
  ]);
  const out = await twoStep(h.call, 'fast_forward_contacts', { workflowId: 'WID', stepId: 'S', contactId: 'C' }, { sleep: h.sleep });
  assert.equal(h.calls[1].args.confirm, true);
  assert.equal(h.calls[1].args.confirmationToken, 'tok-ff');
  assert.equal(h.calls[1].args.previewToken, 'roster-1', 'the confirm must also carry the roster previewToken');
  assert.ok(h.calls[1].at - h.calls[0].at >= 20_000, 'the wait applies before the confirm');
  assert.equal(out.final.data.moved, 1);
});

test('bl-1021: the fast-forward leg goes through twoStep, not a single confirm call with a previewToken', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../skills/create-ghl-workflow/scripts/', import.meta.url);
  const conf = readFileSync(new URL('conformance.mjs', dir), 'utf8');
  assert.ok(!conf.includes('previewToken: ffp.data?.preview?.previewToken, confirm: true'), 'the fast-forward confirm is still one call with a previewToken');
  assert.ok(conf.includes("twoStep(call, 'fast_forward_contacts'"), 'the fast-forward leg does not use twoStep');
});

// bl-1021 (orchestrator 2026-11-10): every publish probe ends with a separate read-back that the workflow is a draft; the flow-entry
// probe is unpublished and read back as a draft right after its build (build_workflow leaves an agent-type flow published).
test('bl-1021: every unpublish in the create-ghl-workflow scripts asserts draft on a separate GET', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../../skills/create-ghl-workflow/scripts/', import.meta.url);
  const bare = /await call\('unpublish_workflows'/;
  const offenders = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'probe-readback.mjs' && f !== 'run-hygiene.mjs')
    .filter((f) => bare.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(offenders, [], `bare unpublish left in: ${offenders.join(', ')}`);
});

test('bl-1021: the flow-entry probe asserts draft right after its build', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../skills/create-ghl-workflow/scripts/', import.meta.url);
  const conf = readFileSync(new URL('conformance.mjs', dir), 'utf8');
  assert.ok(conf.includes("unpublishAndAssertDraft(call, check, fwid, 'flow-entry probe')"), 'the flow-entry probe does not unpublish and read back draft after its build');
});

// fast_forward_contacts' real protocol: its preview carries only the roster previewToken. The first confirm (with that previewToken and
// no confirmationToken) answers CONFIRM_REQUIRED with a confirmationToken; the helper waits, then confirms with BOTH tokens.
test('bl-1021: fast_forward protocol: the confirm that issues the confirmationToken is followed by a waited confirm with both tokens', async () => {
  const h = harness([
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { count: 1, previewToken: 'roster-2' } } },
    { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { count: 1, previewToken: 'roster-2' }, confirmationToken: 'tok-ff' } },
    { ok: true, data: { moved: 1 } },
  ]);
  const out = await twoStep(h.call, 'fast_forward_contacts', { workflowId: 'W', stepId: 'S', contactId: 'C' }, { sleep: h.sleep });
  assert.equal(h.calls.length, 3, 'preview, the token-issuing confirm, then the waited confirm');
  assert.equal(h.calls[1].args.previewToken, 'roster-2');
  assert.equal(h.calls[1].args.confirmationToken, undefined);
  assert.equal(h.calls[2].args.confirmationToken, 'tok-ff');
  assert.equal(h.calls[2].args.previewToken, 'roster-2');
  assert.ok(h.calls[2].at - h.calls[1].at >= 20_000, 'the waited confirm comes at least 20 s after the token was issued');
  assert.equal(out.final.data.moved, 1);
});
