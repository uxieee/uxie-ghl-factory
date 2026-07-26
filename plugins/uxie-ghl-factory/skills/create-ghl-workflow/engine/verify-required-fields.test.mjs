// The round-trip verify pass must assert the required-field set, not just persistence.
//
// Live on AU 2026-07-25 it reported `verify: { pass: 14, issues: [] }` on a flow the
// builder simultaneously showed "Resolve 7 Errors" for. Every check it ran was about
// PERSISTENCE — did the step survive, did an attribute key vanish — and none of them can
// see a step that round-tripped perfectly while missing a field the builder requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate, missingRequiredFields } from './orchestrate.mjs';

// --- the unit ----------------------------------------------------------------------

test('missingRequiredFields flags a required key that was never sent', () => {
  assert.deepEqual(
    missingRequiredFields({ type: 'conversationai_ai_message', attributes: { message: 'hi' } }),
    ['waitForReply']);
});

// The blind spot that `dropped` structurally cannot cover: `dropped` compares KEY
// presence, so a key that IS present but empty looks identical to a healthy one.
test('a required key that is PRESENT but empty is still missing — dropped cannot see this', () => {
  assert.deepEqual(
    missingRequiredFields({ type: 'conversationai_ai_splitter', attributes: { description: '' } }),
    ['description']);
});

test('presence-semantics: waitForReply:false satisfies the requirement', () => {
  assert.deepEqual(
    missingRequiredFields({ type: 'conversationai_ai_message', attributes: { message: 'hi', waitForReply: false } }),
    []);
});

test('a type with no attested required set is never flagged', () => {
  assert.deepEqual(missingRequiredFields({ type: 'add_contact_tag', attributes: { tags: ['a'] } }), []);
  assert.deepEqual(missingRequiredFields({ type: 'transition', attributes: {} }), []);
  assert.deepEqual(missingRequiredFields(undefined), []);
});

test('all three unresolvable ids are flagged when absent', () => {
  assert.deepEqual(missingRequiredFields({ type: 'conversationai_book_appointment', attributes: {} }), ['calendarId']);
  assert.deepEqual(missingRequiredFields({ type: 'conversationai_transfer_bot', attributes: {} }), ['assignedEmployeeId']);
  assert.deepEqual(
    missingRequiredFields({ type: 'conversationai_services_booking',
      attributes: { conversationai_services: [], conversationai_booking_description: 'd' } }),
    ['conversationai_services']);
});

// --- through orchestrate -------------------------------------------------------------

// GHL echoes the step back with `description` emptied. The key is present, so the
// dropped-attribute check stays silent and the old verify counted it a pass.
function mockGateway(persistedTemplates) {
  const call = async (method, path) => {
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [] } };
    if (method === 'GET' && path.includes('/calendars/')) return { ok: true, json: { calendars: [] } };
    if (method === 'GET' && path.includes('/users/')) return { ok: true, json: { users: [] } };
    if (method === 'GET' && path.includes('/forms/')) return { ok: true, json: { forms: [] } };
    if (method === 'GET' && path.includes('/customFields')) return { ok: true, json: { customFields: [] } };
    if (method === 'GET' && (path.includes('/voice-ai/') || path.includes('/ai-employees/'))) return { ok: false, json: {} };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: [] } };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/trigger')) return { ok: true, json: { id: 'TRIG_1' } };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { workflowData: { templates: persistedTemplates } } };
    return { ok: true, json: {} };
  };
  return { call, loc: 'LOC', uid: 'UID' };
}

const splitterIR = () => ({
  name: 'Flow', workflowType: 'agent',
  triggers: [{ ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: 'AGENT1' }],
  graph: [{ ref: 'n', kind: 'action', type: 'conversationai_ai_splitter', name: 'Route by intent',
    branches: [{ name: 'Booking', then: [] }] }],
});

test('verify FAILS a step whose required field came back empty (was: pass, issues:[])', async () => {
  const emptied = [{ id: 'WID_1', type: 'conversationai_ai_splitter', name: 'Route by intent',
    attributes: { description: '', type: 'conversationai_ai_splitter' } }];
  const report = await orchestrate(splitterIR(), mockGateway(emptied));

  const flagged = report.verify.issues.find((i) => i.missingRequired);
  assert.ok(flagged, `expected a missingRequired issue, got ${JSON.stringify(report.verify.issues)}`);
  assert.deepEqual(flagged.missingRequired, ['description']);
  assert.equal(flagged.type, 'conversationai_ai_splitter');
  assert.match(flagged.note, /CANNOT be\s+published/);
});

test('a healthy round-trip still verifies clean', async () => {
  const healthy = [{ id: 'WID_1', type: 'conversationai_ai_splitter', name: 'Route by intent',
    attributes: { description: 'Route by intent', type: 'conversationai_ai_splitter' } }];
  const report = await orchestrate(splitterIR(), mockGateway(healthy));
  assert.equal(report.verify.issues.filter((i) => i.missingRequired).length, 0);
});
