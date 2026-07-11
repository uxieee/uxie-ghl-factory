import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResolvers, resolveIR } from './resolve.mjs';

const raw = {
  pipelines: [
    { id: 'PIPE_SALES', name: 'Sales', stages: [{ id: 'ST_NEW', name: 'New Lead' }, { id: 'ST_WON', name: 'Won' }] },
    { id: 'PIPE_ONB', name: 'Onboarding', stages: [{ id: 'ST_KICK', name: 'Kickoff' }] },
  ],
  calendars: [{ id: 'CAL_CONS', name: 'Consultation' }],
  users: [{ id: 'USR_JANE', firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com' }],
  forms: [{ id: 'FORM_CONTACT', name: 'Contact Us' }],
  customFields: [{ id: 'em3R3rToFy8N0oYcJDwE', name: 'Status', fieldKey: 'contact.status' }],
};
const r = buildResolvers(raw);

test('resolvers: name→id lookups (case-insensitive), stage scoped to pipeline', () => {
  assert.equal(r.pipelineId('sales'), 'PIPE_SALES');
  assert.equal(r.stageId('New Lead', 'Sales'), 'ST_NEW');
  assert.equal(r.stageId('Kickoff'), 'ST_KICK');           // cross-pipeline when no scope
  assert.equal(r.calendarId('Consultation'), 'CAL_CONS');
  assert.equal(r.userId('jane@x.com'), 'USR_JANE');
  assert.equal(r.userId('Jane Doe'), 'USR_JANE');
  assert.equal(r.formId('Contact Us'), 'FORM_CONTACT');
  assert.equal(r.pipelineId('Nonexistent'), undefined);
});

test('resolveIR: opportunity pipeline/stage names → ids', () => {
  const ir = { triggers: [], graph: [
    { ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Op', attributes: { name: 'Deal', pipeline: 'Sales', stage: 'New Lead', status: 'open' } },
  ] };
  const { ir: out, unresolved } = resolveIR(ir, r);
  const a = out.graph[0].attributes;
  assert.equal(a.pipelineId, 'PIPE_SALES');
  assert.equal(a.stageId, 'ST_NEW');
  assert.deepEqual(unresolved, []);
});

test('resolveIR: assign_user + appointment calendar + task assignee', () => {
  const ir = { triggers: [], graph: [
    { ref: 'u', kind: 'action', type: 'assign_user', name: 'A', attributes: { user: 'jane@x.com' } },
    { ref: 'c', kind: 'action', type: 'appointment_booking', name: 'B', attributes: { calendar: 'Consultation' } },
    { ref: 't', kind: 'action', type: 'task-notification', name: 'T', attributes: { assignedTo: 'Jane Doe', title: 'x' } },
  ] };
  const { ir: out } = resolveIR(ir, r);
  assert.deepEqual(out.graph[0].attributes.user_list, ['USR_JANE']);
  assert.equal(out.graph[1].attributes.calendarId, 'CAL_CONS');
  assert.equal(out.graph[2].attributes.assignedTo, 'USR_JANE');
});

test('resolveIR: trigger filter values (pipeline/form/calendar names) → ids', () => {
  const ir = { triggers: [
    { ref: 't1', type: 'pipeline_stage_updated', name: 'P', filters: [{ field: 'opportunity.pipelineId', value: 'Sales' }] },
    { ref: 't2', type: 'form_submission', name: 'F', filters: [{ field: 'form.id', value: ['Contact Us'] }] },
  ], graph: [] };
  const { ir: out } = resolveIR(ir, r);
  assert.equal(out.triggers[0].filters[0].value, 'PIPE_SALES');
  assert.deepEqual(out.triggers[1].filters[0].value, ['FORM_CONTACT']);
});

test('resolveIR: custom-field NAME → id; standard fields + ids left alone', () => {
  const ir = { triggers: [], graph: [
    { ref: 'u', kind: 'action', type: 'update_contact_field', name: 'U', attributes: { fields: [
      { field: 'Status', value: 'active' },                 // custom field by name → id
      { field: 'email', value: '{{x}}' },                   // standard → literal
      { field: 'em3R3rToFy8N0oYcJDwE', value: 'x' },                   // already an id → untouched
    ] } },
  ] };
  const { ir: out, unresolved } = resolveIR(ir, r);
  const fields = out.graph[0].attributes.fields;
  assert.equal(fields[0].field, 'em3R3rToFy8N0oYcJDwE');   // resolved
  assert.equal(fields[0].title, 'Status');      // name preserved as title
  assert.equal(fields[1].field, 'email');       // standard, untouched
  assert.equal(fields[2].field, 'em3R3rToFy8N0oYcJDwE');   // id, untouched
  assert.deepEqual(unresolved, []);
});

test('resolveIR: unknown custom-field name is reported', () => {
  const ir = { triggers: [], graph: [
    { ref: 'u', kind: 'action', type: 'update_contact_field', name: 'U', attributes: { fields: [{ field: 'Ghost Field', value: 'x' }] } },
  ] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(unresolved.some((x) => x.name === 'Ghost Field'), true);
});

test('resolveIR: already-resolved ids pass through; unknown names reported', () => {
  const ir = { triggers: [], graph: [
    { ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Op', attributes: { pipeline: 'Ghost Pipeline', status: 'open' } },
  ] };
  const { unresolved } = resolveIR(ir, r);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].name, 'Ghost Pipeline');
});
