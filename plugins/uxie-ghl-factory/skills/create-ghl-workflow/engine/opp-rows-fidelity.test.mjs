// w6d-4 (plan Task 4): opportunity rows and the find_contact insert, to the builder's own shapes. RED first.
//   bl-407  a DATE custom field on an opportunity row is the builder's custom-input shape (__customInputs__ {value:'date'})
//   bl-409  a NUMERICAL custom field row stores a JSON number; a merge tag on a numeric row is refused with the drawer's reason
//   bl-402  create_opportunity_strict accepts custom fields and emits the same row shape
//   bl-731  an update_opportunity with pipelineId and stageId keeps its pipeline and stage rows next to its updates[]
//   bl-751  a find_contact authored with attributes.fields (the key GHL stores) compiles; the find's fields are not refused
//   bl-879  a find_contact field NAME resolves to the account's custom-field id (the resolver)
//   bl-493  regression pin: a find_opportunity keeps its pipeline filter through build (closed with proof: edit-multipath.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { resolveIR, buildResolvers } from './resolve.mjs';

const CF_DATE = 'cfDateAaaaaaaaaaaaa';
const CF_NUM = 'cfNumBbbbbbbbbbbbb';
const CF_TEXT = 'cfTextCcccccccccccc';
const customFields = [
  { id: CF_DATE, name: 'Go-Live Date', dataType: 'DATE', model: 'opportunity', fieldKey: 'opportunity.go_live_date' },
  { id: CF_NUM, name: 'Deal Value', dataType: 'NUMERICAL', model: 'opportunity', fieldKey: 'opportunity.deal_value' },
  { id: CF_TEXT, name: 'Notes', dataType: 'TEXT', model: 'opportunity', fieldKey: 'opportunity.notes' },
];
const sink = () => { const w = []; const fn = (m) => w.push(m); fn.messages = w; return fn; };
const ctx = (warn = sink()) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('o'),
  catalog: loadCatalog(), customFields, warn });
const tagTrigger = { ref: 't', type: 'contact_tag', name: 'T', filters: [] };
const PIPE = 'pipeId00000000000001';
const STAGE = 'stageId0000000000001';

// An update_opportunity needs an opportunity on its path (the engine refuses OPP_UNASSOCIATED otherwise): a create step is put first
// unless the graph already has a create or a find, so the update's rows are what these tests read.
const PRIME = { ref: 'prime', kind: 'action', type: 'create_opportunity_strict', name: 'Prime', attributes: { pipelineId: PIPE, stageId: STAGE, status: 'open' } };
const withPrime = (graph) => (graph.some((g) => /create_opportunity|find_opportunity/.test(g.type)) ? graph : [PRIME, ...graph]);
const build = (graph, c = ctx()) => compile({ name: 'WF', triggers: [tagTrigger], graph: withPrime(graph) }, c).autoSaveBody.workflowData.templates;
const rowsOf = (templates, type) => (templates.find((t) => t.type === type)?.attributes?.__customInputFields__ ?? []);

// ─── bl-407: DATE custom field → the builder's custom-input shape ─────────────────────────────────────────────────────
test('bl-407: a DATE opportunity custom-field row emits the builder\'s custom-input shape (__customInputs__ {value:\'date\'})', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Set go-live', attributes: {
    updates: [{ field: `custom_fields.${CF_DATE}`, value: '{{right_now.middle_endian_date}}' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === `custom_fields.${CF_DATE}`);
  assert.ok(row, JSON.stringify(rowsOf(t, 'internal_update_opportunity')));
  assert.equal(row.valueFieldType, 'custom-input');
  assert.deepEqual(row.__customInputs__, { value: 'date' });
  assert.equal(row.dataType, 'DATE');
  assert.equal(row.value, '{{right_now.middle_endian_date}}');
});

// ─── bl-409: numeric rows store a JSON number; a merge tag on a numeric row is refused ─────────────────────────────
test('bl-409: a NUMERICAL custom-field row emits valueFieldType numerical and a literal as a JSON number', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Set value', attributes: {
    updates: [{ field: `custom_fields.${CF_NUM}`, value: '0' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === `custom_fields.${CF_NUM}`);
  assert.equal(row.valueFieldType, 'numerical');
  assert.equal(row.value, 0, 'a JSON number, not the string "0"');
  assert.equal(row.dataType, 'NUMERICAL');
});

test('bl-409: a merge tag on a numeric custom-field row is refused with the drawer\'s reason', () => {
  assert.throws(() => build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Set value', attributes: {
    updates: [{ field: `custom_fields.${CF_NUM}`, value: '{{custom_values.deal_value}}' }] } }]),
  (e) => e.code === 'OPP_NUMERIC_MERGE_TAG' && /merge tag/i.test(e.message));
});

// ─── bl-402: create_opportunity_strict accepts custom fields, in the UI row shape ──────────────────────────────────
test('bl-402: create_opportunity_strict with customFields emits them as rows in the UI shape, after its standard rows', () => {
  const t = build([{ ref: 'c', kind: 'action', type: 'create_opportunity_strict', name: 'Create', attributes: {
    pipelineId: PIPE, stageId: STAGE, status: 'open',
    customFields: [{ field: `custom_fields.${CF_NUM}`, value: 3 }, { field: `custom_fields.${CF_DATE}`, value: '{{right_now.middle_endian_date}}' }],
  } }]);
  const rows = rowsOf(t, 'internal_create_opportunity');
  const num = rows.find((r) => r.filterField === `custom_fields.${CF_NUM}`);
  const date = rows.find((r) => r.filterField === `custom_fields.${CF_DATE}`);
  assert.equal(num.valueFieldType, 'numerical');
  assert.equal(num.value, 3);
  assert.equal(date.valueFieldType, 'custom-input');
  assert.deepEqual(date.__customInputs__, { value: 'date' });
  assert.ok(rows.indexOf(num) > rows.findIndex((r) => r.filterField === 'pipelineStageId'), 'custom rows follow the standard rows');
});

// ─── bl-731: a new update_opportunity keeps its pipeline and stage rows beside updates[] ─────────────────────────────
test('bl-731: update_opportunity with pipelineId, stageId and updates[] keeps the pipeline and stage rows (pipeline first)', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Move and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const rows = rowsOf(t, 'internal_update_opportunity').map((r) => r.filterField);
  assert.ok(rows.includes('pipelineId'), `pipeline row missing: ${rows.join(', ')}`);
  assert.ok(rows.includes('pipelineStageId'), `stage row missing: ${rows.join(', ')}`);
  assert.ok(rows.includes(`custom_fields.${CF_TEXT}`));
  assert.ok(rows.indexOf('pipelineId') < rows.indexOf('pipelineStageId'), 'pipeline precedes stage');
});

// ─── bl-751: a find_contact authored with attributes.fields compiles ───────────────────────────────────────────────
test('bl-751: a find_contact authored with attributes.fields (the key GHL stores) compiles and keeps its fields', () => {
  const t = build([{ ref: 'f', type: 'find_contact', name: 'Find dup', attributes: { fields: [
    { field: 'email', value: '{{contact.email}}', title: 'Email', type: 'string', date: '' }] } }]);
  const find = t.find((x) => x.type === 'find_contact');
  assert.ok(find, 'a find_contact container was built');
  assert.equal(find.attributes.fields[0].field, 'email');
});

// ─── bl-879: a find_contact field NAME resolves to the account's id (the resolver, not the compiler) ──────────────────
test('bl-879: a find_contact field named by the account\'s field NAME resolves to its id', () => {
  const r = buildResolvers({ customFields: customFields.map((c) => ({ id: c.id, name: c.name, fieldKey: c.fieldKey, dataType: c.dataType, model: c.model })) });
  const ir = { name: 'WF', triggers: [], graph: [{ ref: 'f', type: 'find_contact', name: 'Find', find: { fields: [
    { field: 'Notes', value: 'x', title: 'Notes', type: 'string', date: '' }] } }] };
  const { unresolved } = resolveIR(ir, r);
  assert.deepEqual(unresolved, []);
  assert.equal(ir.graph[0].find.fields[0].field, CF_TEXT);
});

test('bl-879: a find_contact field name that the account does not list is reported unresolved, not silently kept', () => {
  const r = buildResolvers({ customFields: [] });
  const ir = { name: 'WF', triggers: [], graph: [{ ref: 'f', type: 'find_contact', name: 'Find', find: { fields: [
    { field: 'No Such Field', value: 'x', type: 'string', date: '' }] } }] };
  const { unresolved } = resolveIR(ir, r);
  assert.ok(unresolved.some((u) => u.where === 'find_contact.field' && u.name === 'No Such Field'), JSON.stringify(unresolved));
});

// ─── bl-493: regression pin (closed with proof) ───────────────────────────────────────────────────────────────────
test('bl-493: a find_opportunity keeps its pipeline filter through build (pinned; closed with proof in edit-multipath.test.mjs)', () => {
  const t = build([{ ref: 'f', kind: 'find_opportunity', name: 'Find opp', find: { filters: [{ field: 'pipeline_id', value: PIPE }], sorting: 'latest' }, onFound: [], onNotFound: [] }]);
  const rows = rowsOf(t, 'find_opportunity');
  assert.ok(rows.some((r) => r.filterField === 'pipeline_id' && r.value === 'eq' && r.secondValue === PIPE), JSON.stringify(rows));
});

// ─── w6d-4 QA FAIL item 1: the name-path keys authored beside updates[] are written, not dropped ───────────────────
// Before the fix, the explicit-updates branch carried only pipelineId and stageId; an authored status, name, value, source,
// lostReasonId or forecast field beside updates[] compiled to no row, with no error and no warning.
test('w6d-4 QA: a status authored beside updates[] is written as a status row (not dropped)', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Won and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, status: 'won', updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'status');
  assert.ok(row, `status row missing: ${rowsOf(t, 'internal_update_opportunity').map((r) => r.filterField).join(', ')}`);
  assert.equal(row.value, 'won');
});

test('w6d-4 QA: a name authored beside updates[] is written as a name row', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Rename and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, name: 'Renamed', updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'name');
  assert.ok(row, 'name row missing');
  assert.equal(row.value, 'Renamed');
});

test('w6d-4 QA: a value authored beside updates[] is written as a numerical monetaryValue row (a JSON number)', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Value and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, value: 500, updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'monetaryValue');
  assert.ok(row, 'monetaryValue row missing');
  assert.equal(row.value, 500);
  assert.equal(row.valueFieldType, 'numerical');
});

test('w6d-4 QA: an explicit updates[] row wins over the same name-path key (one row, the explicit value)', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Dedup', attributes: {
    pipelineId: PIPE, stageId: STAGE, status: 'won',
    updates: [{ field: 'status', value: 'lost' }, { field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const statusRows = rowsOf(t, 'internal_update_opportunity').filter((r) => r.filterField === 'status');
  assert.equal(statusRows.length, 1, `status rows: ${statusRows.length}`);
  assert.equal(statusRows[0].value, 'lost');
});

// ─── w6d-4 QA FAIL #2: source, lostReasonId and the two forecast fields beside updates[] (each written, each proven live) ──────────
const LOST_REASON_ID = 'lostReasonAaaaaaaaaaaaaa'; // a placeholder for the unit test; the live case uses the sandbox's own lost-reason id
test('w6d-4 QA #2: a source authored beside updates[] is written as a source row (TEXT, string)', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Source and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, source: 'TEST-CONF-W6D-4', updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'source');
  assert.ok(row, 'source row missing');
  assert.equal(row.value, 'TEST-CONF-W6D-4');
  assert.equal(row.valueFieldType, 'string');
});

test('w6d-4 QA #2: a lostReasonId authored beside updates[] with status lost is written as a lostReasonId row', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Lost and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, status: 'lost', lostReasonId: LOST_REASON_ID, updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const rows = rowsOf(t, 'internal_update_opportunity');
  const row = rows.find((r) => r.filterField === 'lostReasonId');
  assert.ok(row, `lostReasonId row missing: ${rows.map((r) => r.filterField).join(', ')}`);
  assert.equal(row.value, LOST_REASON_ID);
  assert.equal(rows.find((r) => r.filterField === 'status').value, 'lost');
});

test('w6d-4 QA #2: a lostReasonId beside updates[] WITHOUT status lost is refused by name (the picker prerequisite), not dropped', () => {
  assert.throws(() => build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Lost no status', attributes: {
    pipelineId: PIPE, stageId: STAGE, status: 'open', lostReasonId: LOST_REASON_ID, updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]),
  (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS');
});

test('w6d-4 QA #2: a forecastExpectedCloseDate beside updates[] is written as its row', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Forecast date and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, forecastExpectedCloseDate: '2026-12-31', updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'forecastExpectedCloseDate');
  assert.ok(row, 'forecastExpectedCloseDate row missing');
  assert.equal(row.value, '2026-12-31');
});

test('w6d-4 QA #2: a forecastProbability beside updates[] is written as its row', () => {
  const t = build([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Probability and set', attributes: {
    pipelineId: PIPE, stageId: STAGE, forecastProbability: 50, updates: [{ field: `custom_fields.${CF_TEXT}`, value: 'hello' }] } }]);
  const row = rowsOf(t, 'internal_update_opportunity').find((r) => r.filterField === 'forecastProbability');
  assert.ok(row, 'forecastProbability row missing');
  assert.equal(row.value, 50);
});
